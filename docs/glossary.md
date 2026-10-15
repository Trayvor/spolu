# Glossary

Terms used across the docs and code, in alphabetical order.

- **admin**: an eGrant team member. Sees all groups and can manage them. Created by the superadmin.
- **API key**: a secret token that eGrant sends with each ticket request to prove who it is.
- **bucket**: a column on a task board (for example "To do"). Tasks live in buckets and can be reordered.
- **channel**: a place where messages are posted. In eHub: a group chat, a direct message chat or a task chat.
- **client**: a person from a customer organization. Sees only their own group.
- **contract**: a record of an agreement with a client (dates, amount, files, notes). Admin-only.
- **draft contract**: the prepared next contract for a client, with the same fields as a contract.
- **egrant URL**: the address of a client's eGrant instance, saved on the group. Incoming tickets are matched to a group by it. It is normalized first (case, protocol, trailing slash and similar differences are removed) so that equal addresses compare equal.
- **group**: one client organization with its own chat, task board, tickets and contracts.
- **invite link**: a link an admin copies from a group. A client opens it, enters an email, gets a code and joins that group.
- **member**: a user who belongs to a group.
- **mention**: tagging a user with @ in a message so they are notified.
- **message**: one post in a channel. Can have attachments, a thread and mentions.
- **OTP code**: the one-time code sent by email that is used to log in.
- **PWA**: progressive web app. The web app can be installed on a phone or desktop and receive push notifications.
- **read state**: what a user has already read in a channel; used for the unread indicator.
- **reminder**: a scheduled notification to admins that a contract is about to need attention.
- **seq**: a per-channel increasing number on each message. Clients use it to find and load messages missed during a disconnect.
- **session**: a long-lived login on one device, kept after the code is entered.
- **superadmin**: the first admin, created automatically at first start from `SUPERADMIN_EMAIL`. Cannot be deleted or demoted; creates other admins.
- **task**: a card on the task board with title, description, assignee, deadline, priority and labels.
- **task chat**: the discussion inside one task, with threads, mentions and attachments.
- **thread**: replies grouped under one message.
- **ticket**: a support request sent from eGrant, with a status (New / In progress / Resolved), shown in the matching group or in the global list.
