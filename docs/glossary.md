# Glossary

Terms used across the docs and code, in alphabetical order.

- **admin**: an eGrant team member. Sees all groups and can manage them. Created by the superadmin.
- **ADR**: architecture decision record, a short file in `docs/decisions/` that records one decision and why it was made.
- **API key**: a secret token that eGrant sends with each ticket request to prove who it is.
- **bucket**: a column on a task board (for example "To do"). Tasks live in buckets and can be reordered.
- **channel**: a place where messages are posted. In Spolu: a group chat, a direct message chat or a task chat.
- **client**: a person from a customer organization. Sees only their own group.
- **contract**: a record of an agreement with a client (dates, amount, files, notes). Admin-only.
- **deactivated admin**: an admin who was removed. The row is kept with `disabled_at` set; the person cannot log in, gets no codes and loses open sessions and sockets. Adding the same email again reactivates them.
- **draft contract**: the prepared next contract for a client, with the same fields as a contract.
- **egrant URL**: the address of a client's eGrant instance, saved on the group. Incoming tickets are matched to a group by it. It is normalized first (case, protocol, trailing slash and similar differences are removed) so that equal addresses compare equal.
- **group**: one client organization with its own chat, task board, tickets and contracts.
- **invite link**: a link an admin copies from a group. A client opens it, enters an email, gets a code and joins that group.
- **login code**: the 6-digit one-time code sent by email to log in; valid 5 minutes, 3 tries. Also called OTP code.
- **member**: a user who belongs to a group.
- **mention**: tagging a user with @ in a message so they are notified.
- **message**: one post in a channel. Can have attachments, a thread and mentions.
- **module**: a self-contained feature area of the server (for example chat or tasks) that owns its routes, policies and tables.
- **notification event**: one stored notification for one recipient (kind, optional group, payload, delivered or not). Recorded in the same transaction as the change that caused it and deleted after 30 days.
- **OTP code**: the one-time code sent by email that is used to log in.
- **owner walkthrough**: the final check of a phase, where the owner tries the "Done when" items by hand before the phase is marked done.
- **pending client**: a client who entered an email on an invite link but never signed in (`email_verified` false, empty name). A later invite link moves them to its group; once they sign in they are a normal client.
- **policy function**: a server function that decides whether a user may see or change a resource; written test-first.
- **PWA**: progressive web app. The web app can be installed on a phone or desktop and receive push notifications.
- **read state**: what a user has already read in a channel; used for the unread indicator.
- **reminder**: a scheduled notification to admins that a contract is about to need attention.
- **removed member**: a client an admin removed from a group. The user row is kept with `disabled_at` set and the membership stays, so the admin can restore them; they get no code and lose sessions and sockets. Listed under the group's removed members.
- **room**: a Socket.IO room; users join rooms to receive live events for a group, DM or task channel.
- **seq**: a per-channel increasing number on each message. Clients use it to find and load messages missed during a disconnect.
- **session**: a long-lived login on one device, kept after the code is entered. A `session` row plus the httpOnly cookie `better-auth.session_token`; removing a user deletes their sessions.
- **Spolu**: the product name (Slovak for "together"); full brand "Spolu by eGrant". Formerly the working title eHub.
- **superadmin**: the first admin, created automatically at start from `SUPERADMIN_EMAIL` (name from `SUPERADMIN_NAME`). Cannot be deleted or demoted; creates other admins.
- **task**: a card on the task board with title, description, assignee, deadline, priority and labels.
- **task chat**: the discussion inside one task, with threads, mentions and attachments.
- **test environment**: the Oracle Cloud VM where Spolu is deployed for checks before real use; environment name `test`.
- **thread**: replies grouped under one message.
- **ticket**: a support request sent from eGrant, with a status (New / In progress / Resolved), shown in the matching group or in the global list.
