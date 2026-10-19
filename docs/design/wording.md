# UI wording and terms

The words the UI uses, per language, so every screen names one thing the same way. Any new or changed UI text (web locales and `apps/server/src/infra/i18n/<code>.ts`) uses these terms. Slovak is the source; the other eight languages use their own natural word for the same concept, one word per concept.

The owner chose the Slovak vocabulary on 2026-10-18 (UX review, batch 5): **manažér** (not správca), **Urgentné** (not Súrne), **Vymazať** as the one delete verb, **Financie** (not Finančná správa).

## Rules

- **One term per concept.** Use the term in the table everywhere: buttons, sentences, hints, emails, push titles. A synonym reads as a different thing.
- **Delete vs remove.** "Delete" (sk Vymazať) destroys data: a message, task, column, item, folder, reminder, entry, rate, recording. "Remove" (sk Odobrať) only takes something off a list or out of a form, and the thing still exists: a file from a draft, a person from a group or a picker, a filter chip, a logo, an alias, a time from a reminder form. Unlinking text is "Zrušiť odkaz" (en "Remove link").
- **Impersonal progress texts.** "Načítava sa…", "Upravuje sa…", "Prepisuje sa nahrávka…", never first person ("Načítavam…"). The app speaks as "we" in sentences ("Pošleme vám kód") and impersonally in status lines.
- **Quote UI labels inside sentences** with the language's quotation marks: sk, cs, hr, bg, et „…“; sl »…«; uk «…»; en, it “…”. Example: "kliknite znova na „Vytvoriť“".
- **eGrant takes its case** in Slovak and the other Slavic languages: "v eGrante", "z eGrantu", "Administrátor eGrantu". The admin group keeps its stored name "eGrant tím" in Slovak (it is the group's name in the database, Phase 34).
- **Errors** end with the one "try again" form of the language (sk "Skúste to znova."); a failed save is "Nepodarilo sa uložiť. Skúste to znova." The bulk email editor's short status lines ("Neuložené: …") stay as they are.
- **Overview.** "Prehľad" (en Overview) is only the group's first tab. The finance overview card is "Súhrn" (Summary), the `/finance` items ledger is "Zoznam" (List), the bulk email report is "Výsledok odosielania" (Sending result).

## Terms per language

| Concept | sk | en | cs | sl | hr | bg | uk | et | it |
|---|---|---|---|---|---|---|---|---|---|
| Admin who manages a client | manažér | manager | manažer | upravitelj | voditelj | мениджър | менеджер | haldur | responsabile |
| Administrator | administrátor | admin | administrátor | skrbnik | administrator | администратор | адміністратор | administraator | amministratore |
| Urgent | Urgentné | Urgent | Naléhavé | Nujno | Hitno | Спешно | Термінове | Kiire | Urgente |
| Delete (destroy) | Vymazať | Delete | Smazat | Izbriši | Izbriši | Изтрий | Видалити | Kustuta | Elimina |
| Remove (detach) | Odobrať | Remove | Odebrat | Odstrani | Ukloni | Премахни | Вилучити | Eemalda | Rimuovi |
| Ticket rating (2026-10-19) | hodnotenie | rating | hodnocení | ocena | ocjena | оценка | оцінка | hinnang | valutazione |
| Finance section (nav and title) | Financie | Finance | Finance | Finance | Financije | Финанси | Фінанси | Rahandus | Finanze |
| Knowledge section | Znalosti | Knowledge | Znalosti | Znanje | Znanje | Знания | База знань | Teadmised | Conoscenze |
| Group overview tab | Prehľad | Overview | Přehled | Pregled | Pregled | Преглед | Огляд | Ülevaade | Panoramica |
| Finance overview card | Súhrn | Summary | Souhrn | Povzetek | Sažetak | Обобщение | Підсумок | Kokkuvõte | Sintesi |
| Finance items ledger | Zoznam | List | Seznam | Seznam | Popis | Списък | Список | Loend | Elenco |
| Bulk email report | Výsledok odosielania | Sending result | Výsledek odesílání | Rezultat pošiljanja | Rezultat slanja | Резултат от изпращането | Результат надсилання | Saatmise tulemus | Risultato dell'invio |
| Column: eGrant reviews | Kontroluje eGrant | eGrant review | Kontroluje eGrant | Preverja eGrant | Provjera eGranta | Проверка от eGrant | Перевіряє eGrant | eGranti ülevaatus | Revisione eGrant |
| Column: the client reviews | Kontroluje klient / Kontroluje {{group}} | Client review / {{group}} review | Kontroluje klient / Kontroluje {{group}} | Preverja stranka / Preverja {{group}} | Provjera klijenta / Provjera: {{group}} | Проверка от клиента / Проверка от {{group}} | Перевіряє клієнт / Перевіряє {{group}} | Kliendi ülevaatus / Ülevaatus: {{group}} | Revisione cliente / Revisione {{group}} |
| Done (column, status) | Hotové | Done | Dokončené | Dokončano | Dovršeno | Завършени | Виконано | Lõpetatud | Completate |
| Ticket in progress | V riešení | In progress | Řeší se | V obdelavi | U obradi | В процес | У роботі | Töös | In lavorazione |
| No assignee | Bez riešiteľa | No assignee | Bez řešitele | Brez izvajalca (tasks), Brez reševalca (tickets) | Bez rješavatelja | Без отговорник | Без виконавця | Lahendajata | Senza assegnatario |
| Ticket requester (the initiator) | žiadateľ | requester | žadatel | prijavitelj | podnositelj zahtjeva | заявител | заявник | taotleja | richiedente |
| Record time (call to action) | Zapíšte strávený čas | Record your time | Zapište strávený čas | Vpišite porabljeni čas | Upišite utrošeno vrijeme | Запишете отделеното време | Запишіть витрачений час | Sisestage kulunud aeg | Registra il tempo impiegato |
| Record time (button) | Zapísať čas | Record time | Zapsat čas | Vpiši čas | Upiši vrijeme | Запиши време | Записати час | Sisesta aeg | Registra il tempo |
| Without recorded time | Bez zapísaného času | Without recorded time | Bez zapsaného času | Brez vpisanega časa | Bez upisanog vremena | Без записано време | Без записаного часу | Sisestamata ajaga | Senza tempo registrato |
| Any (filter) | Akýkoľvek | Any | Jakýkoli | Kateri koli | Bilo koji | Всеки | Будь-який | Ükskõik milline | Qualsiasi |
| Show more | Zobraziť ďalšie | Show more | Zobrazit další | Prikaži več | Prikaži još | Покажи още | Показати більше | Näita rohkem | Mostra altri |
| Try again | Skúste to znova | Try again | Zkuste to znovu | Poskusite znova | Pokušajte ponovno | Опитайте отново | Спробуйте ще раз | Proovige uuesti | Riprovare (button: Riprova) |
| Invitation link | odkaz na pozvánku | invite link | pozvánkový odkaz | povezava za povabilo | poveznica za pozivnicu | връзка за покана | посилання-запрошення | kutselink | link di invito |
| Replace | Nahradiť | Replace | Nahradit | Zamenjaj | Zamijeni | Замени | Замінити | Asenda | Sostituisci |
| Undo | Vrátiť | Undo | Vrátit | Razveljavi | Poništi | Отмени | Скасувати | Võta tagasi | Annulla |
| Stop sending | Zastaviť odosielanie | Stop sending | Zastavit odesílání | Ustavi pošiljanje | Zaustavi slanje | Спри изпращането | Зупинити надсилання | Peata saatmine | Interrompi invio |
| Open (not active) tickets | otvorené tikety | open tickets | otevřené tikety | odprti zahtevki | otvoreni tiketi | отворени тикети | відкриті тікети | avatud pöördumised | ticket aperti |
| AI split proposals | úlohy (not karty) | tasks (not cards) | úkoly | naloge | zadaci | задачи | завдання | ülesanded | attività |
| eGrant team (in prose) | tím eGrant | eGrant team | Tým eGrant | Ekipa eGrant | Tim eGranta | Екип eGrant | Команда eGrant | eGranti meeskond | Team eGrant |
| AI | AI ("zhrnutie od AI") | AI ("summary from AI") | AI | AI | AI | AI | ШІ | AI | IA |

## Server texts

The emails and pushes in `apps/server/src/infra/i18n/<code>.ts` follow the same terms. Their shapes:

- a task moved: "Presunuté do stĺpca „{column}“" (en "Moved to the “{column}” column");
- ticket pushes: "Tiket #123: stav „V riešení“", "Tiket #123: upravené údaje", "Tiket #123: vytvorené 3 úlohy";
- the digest email: subject "3 nové správy – {topic}", button "Otvoriť skupinu" (no name: the name would need a case);
- the time request: "Zapíšte strávený čas", a line "{title}: zapíšte strávený čas";
- settings paths as "Nastavenia → Prístup pre AI (MCP)".

The AI prompt built for "Vyriešiť s Claude" (`modules/ai/claude-context.ts`) names the columns with the Slovak terms too.
