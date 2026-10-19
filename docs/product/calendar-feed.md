# Calendar subscription (Kalendár)

Built 2026-10-19 ([ADR 0051](../decisions/0051-personal-calendar-feed.md), spec [2026-10-19-ics-calendar-design.md](../superpowers/specs/2026-10-19-ics-calendar-design.md)). A person subscribes once to their own calendar feed (iCalendar over HTTPS) in Google Calendar, Outlook or Apple Calendar, and from then on sees their Help dates there. The calendar app polls the link; every poll answers with what the person may read at that moment. The feed is read-only.

## Who has one

| Who | Project events | Task deadlines | Calls |
|---|---|---|---|
| Admin, superadmin | the active groups they manage (plus the admin group); nothing when they manage none | only tasks assigned to them, in any active group | calls of the groups they manage, public and admins-only |
| Client (an active client membership) | every active group they are a client of | tasks assigned to them there | public calls of those groups |
| Žiadateľ only | no feed: the card is hidden, the API answers 403 | | |

Completed tasks, events of archived projects and everything of a deactivated group are left out. A client who loses their last client membership gets an empty calendar (so the app clears the dates); a disabled account's link answers 404 and deactivation deletes the feed.

## The Settings card

**Nastavenia → Kalendár** (between Upozornenia and the admins' cards), for admins and clients:

- Without a feed: three switches (Udalosti projektov, Termíny mojich úloh, Hovory, all on) and **Vytvoriť odkaz na kalendár**.
- With a feed: the link in a read-only field with **Kopírovať**, **Pridať do Google Kalendára** (opens Google's "add by URL" in a new tab) and **Pridať do Apple alebo Outlook** (the `webcal://` link), the warning that anyone with the link sees the dates without signing in, when a calendar last fetched it (noted at most once an hour), the switches (a change saves at once, "Uložené"), **Vytvoriť nový odkaz** and **Zrušiť odber**, each after a confirm sheet. The link can be shown again at any time.
- Creating and rotating a link emails the owner ("Vytvorili ste odkaz na odber kalendára"), in case someone else did it with their session.

## In the calendar

- Name: "Help – <the person's name>"; texts in the person's profile language.
- **Project event**: all-day; "<project> · <event>", the description (first 1 000 characters, mentions as names of the group or `@?`) and a link to the event in Prehľad.
- **Task deadline**: all-day on the due date; "Termín: <title>", the description and a link to the task. The UID is the one the reminders' one-off export gives the deadline, so an imported copy is updated, not doubled.
- **Call**: timed (UTC), lasting the Teams meeting's length or 60 minutes; "Hovor: <title>", the meeting link as LOCATION; the description holds only the links, never notes, transcript or summary. Each call of a recurring series is its own event.
- For admins every summary starts with the client's name ("Obec Lúky: Hovor: Porada").
- No alarms (Help notifies through its own reminders). Window: 30 days back to 365 days ahead, at most 1 000 rows per kind.

## API

`GET`, `PUT` (`{ include: { events, tasks, calls } }`, 201 on create), `POST …/rotate` and `DELETE /api/me/calendar-feed` (own feed only; PUT and rotate 20 an hour, 429 `rate_limited`). The public `GET /api/public/calendar/<token>/help.ics` needs no session: `text/calendar`, an ETag (304 on a match), `Cache-Control: private, max-age=900`; 404 for every failure; 60 a minute per address and 20 a minute per link. None of these routes is reachable from MCP.
