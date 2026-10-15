# Technical support (tickets from eGrant)

The existing error-reporting system in eGrant sends tickets to the Spolu API. The server finds the right group by the client's eGrant URL. Admins see all tickets globally, can assign them to groups, change status and reply by email from Spolu. Clients see the tickets of their group.

## Requirements

- **Intake:**
  - the existing eGrant error-reporting system sends an **HTTP request (JSON)** to the Spolu API;
  - the request is authenticated by an **API key**.
- **JSON fields** (all required):

  | Field | Required | Description |
  |---|---|---|
  | `subject` | yes | subject |
  | `thematic_area` | yes | thematic area |
  | `body` | yes | message text |
  | `email` | **yes, cannot be empty** | email of the client who reported the error; the reply goes to it |
  | `client_url` | yes | client URL in eGrant |

- A request with an empty or missing required field is rejected with a validation error.
- The server compares `client_url` with the "client URL in eGrant" field of groups.
  - **URL normalization:** before comparing, both URLs are brought to one form: no protocol, no `www.`, no trailing slash, lowercase. Example: `https://www.X.egrant.sk/` becomes `x.egrant.sk`.
  - **match:** the ticket goes into that group and into the global list;
  - **no match:** the ticket is **still accepted and saved**, but without a group. It is visible **only in the admin's global ticket list**.
- **Manual assignment:** an administrator can manually attach a ticket without a group (or move a ticket) to any group.
- **Ticket statuses** (exactly three):
  1. New
  2. In progress
  3. Resolved
- **Replying to a ticket:**
  - an administrator (manager) can reply to a ticket from the Spolu interface;
  - the reply is **stored in the ticket itself**: the conversation is visible in Spolu, not only in email;
  - the reply is sent by **email through Elastic Email** at the same time:
    - to the **client** (address from the ticket);
    - to the **manager** who replied (in copy, visible to the client);
  - the client sees the email is addressed to both them and the manager; if they press "Reply all", the manager receives the reply;
  - the client's email reply is **not imported** into the Spolu ticket; it is enough that the manager receives it in their own mailbox.
- **Visibility:**
  - a client sees the tickets of their group (a "Technical support" section inside the group, visible to the client);
  - an administrator sees tickets globally.
- **Global "Technical support" section (admin only):**
  - one list of tickets from **all groups**, plus tickets **without a group** (client URL not found);
  - filters: group / client, status, date, "without group".
- Admins are notified about new tickets (see `notifications.md`).
- Example of done: eGrant sends an error and the ticket appears in the right group, or in the global list as "without group".

## Phase

Phase 12 (intake, URL normalization, statuses, global list, manual assignment, group section, admin notification). Phase 13 (replies).
