# 0043 Signed invitation context in the invitation email's login link

Date: 2026-10-18
Status: accepted

## Context
A person an admin adds by email (or eGrant adds as a manager account) gets an invitation email that links to `/login?email=<their email>`. The email names the group and the inviter; the login page did not, so a new client landed on a bare "Log in" card and then on "How should we call you?" with nothing saying who asked them in, where, or what Help is for (UX review X19).

Putting the group and inviter names in the URL as plain text would let anyone craft a link that shows any text on our login page ("Your bank invited you to …"). Storing an invitation row with a random token would work, but is a new table and lifecycle for a piece of text.

## Decision
The link carries a signed, stateless context: `/login?email=<email>&invite=<groupId>.<base64url(inviter name)>.<base64url HMAC-SHA256(APP_SECRET, "invite:<groupId>:<inviter name>:<email lower case>")>` (`modules/groups/invite-token.ts`, the same shape as the bulk-email unsubscribe token). The login page asks `GET /api/invitations/context?token=&email=` (no session), which answers `{ groupName, invitedBy }` only when the signature matches that email and the person is still an active member of a group that is not deactivated, and `404 not_found` otherwise. The group name is read live; the inviter's name is the one signed into the link. The login page keeps the answer in `sessionStorage` (this tab only) for the name step on `/welcome`, which clears it.

## Consequences
- No table, no expiry: rotating `APP_SECRET` invalidates old links, which then show the plain login page. Removing the person from the group (or cancelling the invite) or deactivating the group silences the link too.
- The endpoint reveals a group's name and an inviter's name only to someone holding a token signed for that exact email, i.e. the email's recipient; a forged or mismatched token learns nothing beyond a 404.
- The sign-in itself is unchanged: the context is only text, never an authorisation.
