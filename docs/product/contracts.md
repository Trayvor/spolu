# Contracts (admins only)

Administrators track client contracts: dates, amount, files, notes, a draft of the next contract and a reminder before signing. The module is never visible to clients. There is also a global list across all groups.

## Requirements

- The module is **not visible to clients** at all.
- Contracts live in a group's "Contracts" module, **admins only**.
- **Contract fields:**
  - start date ("from");
  - end date ("to");
  - amount (no currency, at the start);
  - attached files;
  - notes / comments.
- **Draft of the next contract:** to the current contract an administrator can add a **draft of the next one** with its own "from / to" dates, amount, files and notes.
- **Reminder:**
  - for a contract it is set **how long before the signing date** to send a reminder (for example, 30 days; the roadmap counts it in days);
  - at the set moment administrators receive a **notification**: it is time to communicate with the client about signing the next contract;
  - the delivery channel is defined by the general notification settings (see `notifications.md`): push and/or email according to the profile.
- Not needed at the start: currency, history / archive of contracts.
- **Global "Contracts" section (admin only):**
  - one list of contracts from **all groups**;
  - sorting and filters: end date, amount, client, nearest reminders;
  - clearly shows contracts that are **ending soon** and those where communication is already needed (marked "ending soon" and "communication needed").
- A background scheduler sends the reminders.
- Example of done: the admin manages the contracts of all clients and sees them in one list; on the set day admins receive the reminder.

## Phase

Phase 14 (records, draft of next contract, global list). Phase 15 (reminders and the "ending soon" / "communication needed" marks).
