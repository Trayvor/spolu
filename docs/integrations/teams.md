# Microsoft Teams: setup for the owner

Help by eGrant can create Teams meetings for a knowledge meeting ("call"), send the Outlook invitations, switch on automatic recording and transcription, and attach the transcript to the call after it ends, also for meetings made in Teams and connected by their link. Design and research: [spec](../superpowers/specs/2026-10-18-teams-integration-design.md), [ADR 0036](../decisions/0036-teams-graph-app-only-plain-fetch.md). What admins see: [knowledge-base.md](../product/knowledge-base.md#teams-meetings-teams-t1-built).

Until the steps below are done and the server's env file has the `TEAMS_*` values, the feature is **off and invisible**: deploys work as before.

> **Legal (for the owner).** Client contracts and the privacy notice do not cover recording yet. Help puts a short notice in every invitation and on the public calendar page ("This call will be recorded and transcribed"), but the contracts and the privacy notice must be updated by you. Help decides nothing legal.

## What you need

A **Global Administrator** of eGrant's Microsoft 365 (or one person with Application Administrator, Teams Administrator and Exchange Administrator). About an hour. Steps 1 to 5 are clicks in a browser; 6 to 8 are PowerShell commands the developer can run with you on a shared screen. No extra Microsoft cost: the Teams APIs are not metered since 2025-08-25, and nothing needs Teams Premium.

## 1. Make the group of organizers (Entra admin center, https://entra.microsoft.com)

1. Groups > All groups > **New group**. Type **Security** (if Exchange refuses it in step 8, make it **Mail-enabled security** in the Exchange admin center). Name `Help – Teams organizers`.
2. Members: **every eGrant colleague who may organise calls from Help**, added directly (not through another group). Any Help admin may create a meeting, but only members of this group succeed; the others get "Your Microsoft account is not in the Help Teams organizers group".
3. Copy the group's **Object ID** (steps 6 and 8).

## 2. Register the app

1. Entra admin center > Identity > Applications > **App registrations** > **New registration**.
2. Name `Help by eGrant – Teams`; **Accounts in this organizational directory only**; no redirect URI. **Register**.
3. Copy **Application (client) ID** and **Directory (tenant) ID**.

## 3. Add the permissions

1. **API permissions** > **Add a permission** > **Microsoft Graph** > **Application permissions**.
2. Tick `OnlineMeetings.ReadWrite.All` (find the meeting, switch on automatic recording), `OnlineMeetingTranscript.Read.All` (read transcripts) and `User.ReadBasic.All` (find an admin's account by email). **Add permissions**.
3. **Do not** add `Calendars.ReadWrite` here: step 8 gives it, limited to the group.
4. Remove the delegated `User.Read` Entra adds by default.

## 4. Give admin consent

**Grant admin consent for eGrant** > Yes. Every row shows "Granted".

## 5. Add the credential (choose one; Help supports both)

- **Certificate (recommended):** the developer generates the key pair on the server (`openssl req -x509 -newkey rsa:2048 -nodes -days 730 -keyout teams.pem -out help-teams.cer -subj "/CN=Help by eGrant Teams"`) and sends you only `help-teams.cer`. In the app: **Certificates & secrets** > **Certificates** > **Upload certificate**, description `Help server`. Send the **Thumbprint** to the developer.
- **Client secret:** **Certificates & secrets** > **Client secrets** > **New client secret**, description `Help server`, **12 months**. Copy the **Value** at once (shown only once). Never send it by email or chat: type it into the server's env file yourself, or read it to the developer on a call. Note the expiry date and renew it before then.

## 6. Allow the app to read the group's meetings (PowerShell, Teams module)

```powershell
Install-Module MicrosoftTeams -Scope CurrentUser      # once
Connect-MicrosoftTeams
New-CsApplicationAccessPolicy -Identity "Help-Teams" -AppIds "<Application (client) ID>" -Description "Help by eGrant: meetings and transcripts"
Grant-CsApplicationAccessPolicy -PolicyName "Help-Teams" -Group "<group Object ID>"
```

Never `-Global`. It takes up to 30 minutes. A person has only one such policy: if an organizer already has another, tell the developer.

## 7. Turn on transcripts for apps and automatic recording

1. Teams admin center (https://admin.teams.microsoft.com) > Meetings > **Meeting settings** > **Transcript API access**: **Microsoft Graph access** On; **Include speaker attribution** On. Or `Set-CsTeamsMeetingConfiguration -EnableGraphTranscriptAccess true -EnableAttributedTranscripts true -Identity Global`.
2. Meetings > **Meeting policies** (the organizers' policy, usually **Global**): **Transcription** On, **Recording** On.
3. Automatic recording, which Help switches on by default for its meetings: `Set-CsTeamsMeetingPolicy -Identity Global -AutoRecording Enabled` (or the same on a custom policy granted to the group with `Grant-CsTeamsMeetingPolicy -Group "<group Object ID>" -PolicyName "<policy>"`). Without it Help still creates the meeting; the block shows Microsoft's error and someone starts transcription in the call.

## 8. Allow the app to manage the group's calendars only (PowerShell, Exchange module)

```powershell
Install-Module ExchangeOnlineManagement -Scope CurrentUser   # once
Connect-ExchangeOnline
# IDs from Entra admin center > Enterprise applications > "Help by eGrant – Teams":
New-ServicePrincipal -AppId "<Application ID>" -ObjectId "<Enterprise application Object ID>" -DisplayName "Help by eGrant – Teams"
$dn = (Get-Group "Help – Teams organizers").DistinguishedName
New-ManagementScope -Name "Help Teams organizers" -RecipientRestrictionFilter "MemberOfGroup -eq '$dn'"
New-ManagementRoleAssignment -App "<Enterprise application Object ID>" -Role "Application Calendars.ReadWrite" -CustomResourceScope "Help Teams organizers"
Test-ServicePrincipalAuthorization -Identity "<Enterprise application Object ID>" -Resource "<an organizer's email>"   # InScope True
```

It takes 30 minutes to 2 hours.

## 9. Put the values on the server

In the server's env file (`/opt/spolu/<env>/.env`, see [deploy.md](../runbooks/deploy.md#microsoft-teams)):

```
TEAMS_TENANT_ID=<Directory (tenant) ID>
TEAMS_CLIENT_ID=<Application (client) ID>
# either
TEAMS_CLIENT_SECRET=<the secret value>
# or
TEAMS_CERT_PATH=/run/secrets/spolu/teams.pem
TEAMS_CERT_THUMBPRINT=<thumbprint>
```

Then restart the app. Not secrets (fine by email): the tenant and client ids, the thumbprint, the group's name and Object ID.

## 10. Test together

1. A Help admin in the group opens a client's call in Knowledge, presses **Create Teams meeting**, ticks themselves or a colleague's test address, and creates it. The invitation arrives in Outlook with the recording notice and the add-to-calendar link.
2. Join, speak a minute (recording and transcription start by themselves), end the meeting.
3. Within about 10 minutes the call's **Transcript** shows the text, marked "Only admins see this transcript" until **Share with the client**.
4. In Teams, schedule a meeting yourself, paste its link into another call with **Connect Teams link**, hold it with transcription, and see the transcript arrive the same way.

## Switching it off

Empty the `TEAMS_*` variables and restart (the feature disappears; the stored links stay). On Microsoft's side: delete the app registration, or remove the policy grant (`Grant-CsApplicationAccessPolicy -PolicyName $null -Group …`) and the role assignment (`Remove-ManagementRoleAssignment`).

## What Help stores and shows

- On the call: the join link (as its meeting link), the Teams meeting's ids, organizer, length, the recording choice, where the transcript import stands, and Microsoft's last error code. Admins only.
- The transcript, admins-only until an admin shares it (then it follows the call's visibility like a pasted one). The AI summary made from it is held the same way.
- The public page `/m/<token>` shows only the title, the time, the join link and the recording notice. The token is 128 random bits, never stored (only its hash), and stops working when the meeting is disconnected.
- Secrets live only in the server's env file; the access token only in memory.
