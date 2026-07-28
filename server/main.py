"""
FPS ARENA X — relay.

A thin, in-memory WebSocket forwarder plus the static host for the Vite build.
Three modes reach it:

  * bots  — never connects at all; the client runs the whole match locally.
  * duel  — two players, best-of PVP_MATCH_TARGET rounds.
  * squad — up to 2 x TEAM_MAX players, kill limit or timer.

The wire vocabulary is transcribed in src/net/protocol.js. Both files must
change together.

Design notes that are easy to get wrong:
  * The relay is NOT authoritative over damage — the shooter reports it. It
    IS authoritative over deaths, scores and match end, which is what stops
    the classic +2/+3 score inflation when splash damage lands on a corpse.
  * State is ephemeral and per-process. A restart drops every room, which is
    fine for a single dyno and honest about what this is.
"""

from __future__ import annotations

import asyncio
import json
import os
import random
import time
import uuid

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
# `npm run build` writes ../dist; in production the relay is the only server,
# so it hosts the bundle itself instead of needing a second static host.
DIST_DIR = os.environ.get("DIST_DIR") or os.path.join(os.path.dirname(BASE_DIR), "dist")

ROOM_TTL = int(os.environ.get("ROOM_TTL", "3600"))
TEAM_MAX = int(os.environ.get("TEAM_MAX", "10"))
RESPAWN_SECS = int(os.environ.get("TEAM_RESPAWN_SECS", "5"))
MATCH_KILL_LIMIT = int(os.environ.get("MATCH_KILL_LIMIT", "50"))
MATCH_TIME_LIMIT = int(os.environ.get("MATCH_TIME_LIMIT", "600"))
RECONNECT_TTL = int(os.environ.get("RECONNECT_TTL", "60"))
PVP_MATCH_TARGET = int(os.environ.get("PVP_MATCH_TARGET", "5"))
NICK_MAX = 24

app = FastAPI(title="FPS Arena X relay")


# ----------------------------------------------------------------- utilities


async def send(ws: WebSocket | None, data: dict) -> None:
    """Best-effort send. A dead socket must never abort a broadcast loop."""
    if ws is None:
        return
    try:
        await ws.send_text(json.dumps(data))
    except Exception:
        pass


async def broadcast(sockets, data: dict) -> None:
    for ws in list(sockets):
        await send(ws, data)


def clean_nick(raw) -> str:
    return str(raw or "").strip()[:NICK_MAX]


# --------------------------------------------------------------------- duel


class Duel:
    __slots__ = (
        "id", "a", "b", "ws_a", "ws_b", "spawn_a", "spawn_b",
        "scores", "created", "live", "dying", "over", "rematch",
    )

    def __init__(self, rid: str, a: str, b: str):
        self.id = rid
        self.a, self.b = a, b
        self.ws_a: WebSocket | None = None
        self.ws_b: WebSocket | None = None
        self.spawn_a = random.randint(0, 1)
        self.spawn_b = 1 - self.spawn_a
        self.scores = {a: 0, b: 0}
        self.created = time.time()
        self.live = True
        # Who has already reported a death THIS round. Without this, splash
        # and follow-up bullets that land during the death animation produce
        # a second `died` and the killer scores twice.
        self.dying: set[str] = set()
        self.over = False
        self.rematch: set[str] = set()

    def foe(self, nick: str) -> str:
        return self.b if nick == self.a else self.a

    def foe_ws(self, nick: str):
        return self.ws_b if nick == self.a else self.ws_a

    def both(self):
        return [self.ws_a, self.ws_b]

    def start_payload(self, nick: str, rematch: bool = False) -> dict:
        return {
            "type": "game_start",
            "spawn": self.spawn_a if nick == self.a else self.spawn_b,
            "opponent": self.foe(nick),
            "scores": self.scores,
            "match_target": PVP_MATCH_TARGET,
            "rematch": rematch,
        }


# --------------------------------------------------------------------- squad


class Squad:
    __slots__ = (
        "id", "members", "team_of", "spawns", "scores", "deaths",
        "team_scores", "created", "dying", "ended", "winner", "gone_at",
    )

    def __init__(self, rid: str):
        self.id = rid
        self.members: dict[str, WebSocket | None] = {}
        self.team_of: dict[str, str] = {}
        self.spawns: dict[str, int] = {}
        self.scores: dict[str, int] = {}
        self.deaths: dict[str, int] = {}
        self.team_scores = {"A": 0, "B": 0}
        self.created = time.time()
        self.dying: set[str] = set()
        self.ended = False
        self.winner: str | None = None
        self.gone_at: dict[str, float] = {}

    def size(self, team: str) -> int:
        return sum(1 for t in self.team_of.values() if t == team)

    def smaller_team(self) -> str | None:
        a, b = self.size("A"), self.size("B")
        if a >= TEAM_MAX and b >= TEAM_MAX:
            return None
        return "A" if a <= b else "B"

    def add(self, nick: str, ws: WebSocket) -> str | None:
        team = self.smaller_team()
        if team is None:
            return None
        self.team_of[nick] = team
        self.members[nick] = ws
        self.spawns[nick] = self.size(team) - 1
        self.scores.setdefault(nick, 0)
        self.deaths.setdefault(nick, 0)
        return team

    def others(self, nick: str):
        return [w for n, w in self.members.items() if n != nick and w is not None]

    def live_sockets(self):
        return [w for w in self.members.values() if w is not None]

    def register_kill(self, victim: str, killer: str) -> bool:
        """Returns False for a duplicate/late/post-match death."""
        if self.ended or victim in self.dying or victim not in self.team_of:
            return False
        self.dying.add(victim)
        self.deaths[victim] = self.deaths.get(victim, 0) + 1
        # Team-kills and suicides never feed the team score.
        if killer and killer in self.team_of and killer != victim:
            if self.team_of[killer] != self.team_of[victim]:
                self.scores[killer] = self.scores.get(killer, 0) + 1
                self.team_scores[self.team_of[killer]] += 1
        return True

    def verdict(self):
        for team, score in self.team_scores.items():
            if score >= MATCH_KILL_LIMIT:
                return True, team
        if time.time() - self.created >= MATCH_TIME_LIMIT:
            a, b = self.team_scores["A"], self.team_scores["B"]
            return True, (None if a == b else ("A" if a > b else "B"))
        return False, None

    def snapshot(self) -> dict:
        return {
            "room": self.id,
            "roster": [
                {"nick": n, "team": t, "spawn": self.spawns.get(n, 0),
                 "kills": self.scores.get(n, 0), "deaths": self.deaths.get(n, 0),
                 "online": self.members.get(n) is not None}
                for n, t in self.team_of.items()
            ],
            "scores": self.scores,
            "team_scores": self.team_scores,
            "deaths": self.deaths,
            "kill_limit": MATCH_KILL_LIMIT,
            "time_limit": MATCH_TIME_LIMIT,
            "time_left": max(0, int(MATCH_TIME_LIMIT - (time.time() - self.created))),
        }


# ------------------------------------------------------------------- state

lobby: dict[str, WebSocket] = {}
duels: dict[str, Duel] = {}
duel_of: dict[str, str] = {}
squads: dict[str, Squad] = {}
squad_of: dict[str, str] = {}
open_squad: str | None = None


def sweep() -> None:
    now = time.time()
    for rid in [k for k, v in duels.items() if now - v.created > ROOM_TTL]:
        room = duels.pop(rid, None)
        if room:
            duel_of.pop(room.a, None)
            duel_of.pop(room.b, None)
    for rid in [k for k, v in squads.items() if now - v.created > ROOM_TTL]:
        room = squads.pop(rid, None)
        if room:
            for nick in room.team_of:
                squad_of.pop(nick, None)


def name_taken(nick: str) -> bool:
    return nick in lobby or nick in duel_of or nick in squad_of


# ------------------------------------------------------------------- routes


@app.get("/healthz")
async def healthz():
    return JSONResponse(
        {
            "ok": True,
            "lobby": len(lobby),
            "duels": len(duels),
            "squads": len(squads),
            "match_target": PVP_MATCH_TARGET,
            "kill_limit": MATCH_KILL_LIMIT,
        }
    )


@app.websocket("/ws")
async def ws_endpoint(ws: WebSocket):
    await ws.accept()
    nick: str | None = None
    duel: Duel | None = None
    squad: Squad | None = None

    try:
        while True:
            try:
                msg = json.loads(await ws.receive_text())
            except (json.JSONDecodeError, TypeError):
                continue
            if not isinstance(msg, dict):
                continue
            t = msg.get("type")

            # ---------------------------------------------------- duel lobby
            if t == "register":
                want = clean_nick(msg.get("nickname"))
                if not want:
                    await send(ws, {"type": "error", "msg": "\u041f\u0443\u0441\u0442\u043e\u0439 \u043d\u0438\u043a"})
                    continue
                if name_taken(want):
                    await send(ws, {"type": "error", "msg": "\u041d\u0438\u043a \u0437\u0430\u043d\u044f\u0442"})
                    continue
                if nick:
                    lobby.pop(nick, None)
                nick = want
                lobby[nick] = ws
                await send(ws, {"type": "registered", "nickname": nick})

            elif t == "find":
                target = clean_nick(msg.get("target"))
                if not nick:
                    await send(ws, {"type": "error", "msg": "\u0421\u043d\u0430\u0447\u0430\u043b\u0430 \u0432\u0432\u0435\u0434\u0438\u0442\u0435 \u043d\u0438\u043a"})
                    continue
                if target == nick:
                    await send(ws, {"type": "error", "msg": "\u041d\u0435\u043b\u044c\u0437\u044f \u0438\u0433\u0440\u0430\u0442\u044c \u0441 \u0441\u0430\u043c\u0438\u043c \u0441\u043e\u0431\u043e\u0439"})
                    continue
                if target not in lobby:
                    await send(ws, {"type": "not_found", "target": target})
                    continue
                sweep()
                rid = uuid.uuid4().hex[:8]
                room = Duel(rid, nick, target)
                duels[rid] = room
                foe_ws = lobby.pop(target)
                lobby.pop(nick, None)
                duel_of[nick] = rid
                duel_of[target] = rid
                await send(foe_ws, {"type": "matched", "room": rid,
                                    "spawn": room.spawn_b, "opponent": nick})
                await send(ws, {"type": "matched", "room": rid,
                                "spawn": room.spawn_a, "opponent": target})

            elif t == "join_room":
                sweep()
                rid = msg.get("room", "")
                want = clean_nick(msg.get("nickname"))
                room = duels.get(rid)
                if room is None:
                    await send(ws, {"type": "error", "msg": "\u041a\u043e\u043c\u043d\u0430\u0442\u0430 \u043d\u0435 \u043d\u0430\u0439\u0434\u0435\u043d\u0430"})
                    continue
                if want == room.a:
                    room.ws_a = ws
                elif want == room.b:
                    room.ws_b = ws
                else:
                    await send(ws, {"type": "error", "msg": "\u0412\u044b \u043d\u0435 \u0432 \u044d\u0442\u043e\u0439 \u043a\u043e\u043c\u043d\u0430\u0442\u0435"})
                    continue
                nick, duel = want, room
                if room.ws_a and room.ws_b:
                    room.live = True
                    room.dying.clear()
                    await send(room.ws_a, room.start_payload(room.a))
                    await send(room.ws_b, room.start_payload(room.b))
                else:
                    await send(ws, {"type": "waiting_opponent"})

            # ----------------------------------------------------- duel play
            elif t in ("state", "shot", "grenade_throw") and duel and nick:
                msg["type"] = {"state": "opponent_state", "shot": "opponent_shot",
                               "grenade_throw": "opponent_grenade"}[t]
                await send(duel.foe_ws(nick), msg)

            elif t == "hit" and duel and nick:
                if duel.live and nick not in duel.dying:
                    msg["type"] = "took_damage"
                    await send(duel.foe_ws(nick), msg)

            elif t == "died" and duel and nick:
                if nick in duel.dying or not duel.live or duel.over:
                    continue
                duel.dying.add(nick)
                killer = duel.foe(nick)
                duel.scores[killer] = duel.scores.get(killer, 0) + 1
                duel.live = False
                await broadcast(duel.both(), {
                    "type": "round_over", "killed": nick, "killer": killer,
                    "scores": duel.scores, "match_target": PVP_MATCH_TARGET,
                })
                if duel.scores[killer] >= PVP_MATCH_TARGET:
                    duel.over = True
                    duel.rematch.clear()
                    await broadcast(duel.both(), {
                        "type": "pvp_match_over", "winner": killer,
                        "scores": duel.scores, "match_target": PVP_MATCH_TARGET,
                    })
                else:
                    # Swap spawns so the loser does not eat the same opening.
                    duel.spawn_a, duel.spawn_b = duel.spawn_b, duel.spawn_a

                    async def revive(room: Duel = duel):
                        await asyncio.sleep(RESPAWN_SECS)
                        if room.id not in duels or room.over:
                            return
                        room.live = True
                        room.dying.clear()
                        await send(room.ws_a, {"type": "respawn", "spawn": room.spawn_a,
                                               "scores": room.scores,
                                               "match_target": PVP_MATCH_TARGET})
                        await send(room.ws_b, {"type": "respawn", "spawn": room.spawn_b,
                                               "scores": room.scores,
                                               "match_target": PVP_MATCH_TARGET})

                    asyncio.create_task(revive())

            elif t == "rematch" and duel and nick and duel.over:
                duel.rematch.add(nick)
                await send(duel.foe_ws(nick), {"type": "rematch_wanted", "who": nick})
                if duel.a in duel.rematch and duel.b in duel.rematch:
                    duel.scores = {duel.a: 0, duel.b: 0}
                    duel.over = False
                    duel.live = True
                    duel.rematch.clear()
                    duel.dying.clear()
                    duel.spawn_a = random.randint(0, 1)
                    duel.spawn_b = 1 - duel.spawn_a
                    await send(duel.ws_a, duel.start_payload(duel.a, rematch=True))
                    await send(duel.ws_b, duel.start_payload(duel.b, rematch=True))

            # ---------------------------------------------------- squad join
            elif t == "team_join":
                global open_squad
                want = clean_nick(msg.get("nickname"))
                if not want:
                    await send(ws, {"type": "error", "msg": "\u041f\u0443\u0441\u0442\u043e\u0439 \u043d\u0438\u043a"})
                    continue
                # Reconnect: an unfinished match still holds this slot.
                rid = squad_of.get(want)
                back = squads.get(rid) if rid else None
                if back and not back.ended and back.members.get(want) is None:
                    back.members[want] = ws
                    back.gone_at.pop(want, None)
                    nick, squad = want, back
                    await send(ws, {"type": "team_match_start", "room": back.id,
                                    "team": back.team_of[want], "nickname": want,
                                    "spawn": back.spawns.get(want, 0),
                                    "reconnect": True, **back.snapshot()})
                    await broadcast(back.live_sockets(),
                                    {"type": "team_room_state", **back.snapshot()})
                    continue
                if name_taken(want):
                    await send(ws, {"type": "error", "msg": "\u041d\u0438\u043a \u0437\u0430\u043d\u044f\u0442"})
                    continue
                sweep()
                if open_squad is None or open_squad not in squads:
                    open_squad = uuid.uuid4().hex[:8]
                    squads[open_squad] = Squad(open_squad)
                room = squads[open_squad]
                team = room.add(want, ws)
                if team is None:
                    await send(ws, {"type": "error", "msg": "\u041b\u043e\u0431\u0431\u0438 \u0437\u0430\u043f\u043e\u043b\u043d\u0435\u043d\u043e"})
                    open_squad = None
                    continue
                nick, squad = want, room
                squad_of[want] = room.id
                await send(ws, {"type": "team_joined", "team": team, "nickname": want,
                                **room.snapshot()})
                await broadcast(room.live_sockets(),
                                {"type": "team_lobby_state", **room.snapshot()})

            elif t == "team_start" and squad:
                if squad.size("A") < 1 or squad.size("B") < 1:
                    await send(ws, {"type": "error", "msg": "\u041d\u0443\u0436\u043d\u044b \u043e\u0431\u0435 \u043a\u043e\u043c\u0430\u043d\u0434\u044b"})
                    continue
                if open_squad == squad.id:
                    open_squad = None
                squad.created = time.time()
                for member, sock in squad.members.items():
                    await send(sock, {"type": "team_match_start", "room": squad.id,
                                      "team": squad.team_of[member], "nickname": member,
                                      "spawn": squad.spawns.get(member, 0),
                                      **squad.snapshot()})

            elif t == "team_leave_lobby" and squad and nick:
                # Only meaningful before the match starts. Once it has, the
                # disconnect path owns the slot so a reconnect can reclaim it.
                if squad.id == open_squad and not squad.ended:
                    squad.team_of.pop(nick, None)
                    squad.members.pop(nick, None)
                    squad.spawns.pop(nick, None)
                    squad.scores.pop(nick, None)
                    squad.deaths.pop(nick, None)
                    squad_of.pop(nick, None)
                    await broadcast(squad.live_sockets(),
                                    {"type": "team_lobby_state", **squad.snapshot()})
                    squad = None

            elif t == "team_join_room":
                sweep()
                room = squads.get(msg.get("room", ""))
                want = clean_nick(msg.get("nickname"))
                if room is None or want not in room.team_of:
                    await send(ws, {"type": "error", "msg": "\u041a\u043e\u043c\u043d\u0430\u0442\u0430 \u043d\u0435 \u043d\u0430\u0439\u0434\u0435\u043d\u0430"})
                    continue
                room.members[want] = ws
                nick, squad = want, room
                squad_of[want] = room.id
                await send(ws, {"type": "team_game_start", "team": room.team_of[want],
                                "spawn": room.spawns[want], **room.snapshot()})
                await broadcast(room.live_sockets(),
                                {"type": "team_room_state", **room.snapshot()})

            # ---------------------------------------------------- squad play
            elif t in ("team_state", "team_shot", "team_grenade") and squad and nick:
                msg["type"] = {"team_state": "team_player_state",
                               "team_shot": "team_player_shot",
                               "team_grenade": "team_player_grenade"}[t]
                msg["from"] = nick
                msg["team"] = squad.team_of.get(nick, "A")
                await broadcast(squad.others(nick), msg)

            elif t == "team_hit" and squad and nick:
                target = clean_nick(msg.get("target"))
                # Friendly fire off, and no damage to someone already dying.
                if (target in squad.team_of
                        and squad.team_of.get(target) != squad.team_of.get(nick)
                        and target not in squad.dying
                        and not squad.ended):
                    await send(squad.members.get(target),
                               {"type": "team_took_damage",
                                "damage": int(msg.get("damage", 15)), "from": nick})

            elif t == "team_died" and squad and nick:
                killer = clean_nick(msg.get("killer"))
                if not squad.register_kill(nick, killer):
                    continue
                sockets = squad.live_sockets()
                await broadcast(sockets, {
                    "type": "team_round_over", "killed": nick, "killer": killer,
                    "scores": squad.scores, "team_scores": squad.team_scores,
                    "deaths": squad.deaths,
                    "killer_x": msg.get("killer_x"), "killer_y": msg.get("killer_y"),
                    "killer_z": msg.get("killer_z"),
                    "killed_x": msg.get("x"), "killed_y": msg.get("y"),
                    "killed_z": msg.get("z"),
                })
                done, winner = squad.verdict()
                if done:
                    squad.ended = True
                    squad.winner = winner
                    await broadcast(sockets, {"type": "team_match_end", "winner": winner,
                                              **squad.snapshot()})
                else:
                    async def revive_team(room: Squad = squad, who: str = nick):
                        await asyncio.sleep(RESPAWN_SECS)
                        if room.id not in squads or room.ended:
                            return
                        room.dying.discard(who)
                        await send(room.members.get(who),
                                   {"type": "team_respawn",
                                    "spawn": room.spawns.get(who, 0),
                                    "team": room.team_of.get(who, "A"),
                                    **room.snapshot()})

                    asyncio.create_task(revive_team())

    except WebSocketDisconnect:
        pass
    finally:
        await _cleanup(nick, duel, squad)


async def _cleanup(nick, duel: Duel | None, squad: Squad | None) -> None:
    if not nick:
        return
    lobby.pop(nick, None)
    if duel:
        await send(duel.foe_ws(nick), {"type": "opponent_left"})
        duels.pop(duel.id, None)
        duel_of.pop(duel.a, None)
        duel_of.pop(duel.b, None)
    if squad and nick in squad.team_of:
        # Hold the slot open for RECONNECT_TTL: a browser tab reload should
        # not cost the player their kills or hand the round to the other side.
        squad.members[nick] = None
        squad.gone_at[nick] = time.time()
        await broadcast(squad.live_sockets(),
                        {"type": "team_player_disconnected", "nick": nick,
                         **squad.snapshot()})

        async def forget(room: Squad = squad, who: str = nick):
            await asyncio.sleep(RECONNECT_TTL)
            if room.id not in squads or room.members.get(who) is not None:
                return
            room.team_of.pop(who, None)
            room.members.pop(who, None)
            room.spawns.pop(who, None)
            room.gone_at.pop(who, None)
            squad_of.pop(who, None)
            await broadcast(room.live_sockets(),
                            {"type": "team_player_left", "nick": who, **room.snapshot()})

        asyncio.create_task(forget())


# The SPA mount goes last so it cannot shadow /ws or /healthz.
if os.path.isdir(DIST_DIR):
    app.mount("/", StaticFiles(directory=DIST_DIR, html=True), name="spa")
else:
    @app.get("/")
    async def no_build():
        return JSONResponse(
            {"error": "dist/ not found - run `npm run build` first", "looked_in": DIST_DIR},
            status_code=503,
        )
