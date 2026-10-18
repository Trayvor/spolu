import { useQuery } from '@tanstack/react-query';
import { useParams } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { CalendarLeaf } from '@/features/knowledge/calendar-leaf';
import { ArrowOutIcon } from '@/features/knowledge/icons';
import { ApiError } from '@/lib/api';
import { publicMeetingQuery } from './api';
import { googleLink, icsLink, outlookLink } from './calendar-links';

/** The route component: reads the token from the path. */
export function PublicMeetingRoute() {
  const { token } = useParams({ strict: false }) as { token: string };
  return <PublicMeetingPage token={token} />;
}

const locale = (language: string) => (/^en\b/.test(language) ? 'en-GB' : language);

/**
 * Teams T1: the public add-to-calendar page of a meeting Help created (`/m/<token>`), for
 * anyone with the link, in the viewer's language: the title, the time in their time zone, Join,
 * the calendar links and the recording notice. Nothing else of the meeting is known here.
 */
export function PublicMeetingPage({ token }: { token: string }) {
  const { t, i18n } = useTranslation();
  const query = useQuery(publicMeetingQuery(token));
  if (query.isPending) return null;
  const meeting = query.data;
  if (!meeting) {
    const status = query.error instanceof ApiError ? query.error.status : 0;
    return (
      <Card className="mx-auto w-full max-w-[440px] gap-5 p-8 max-[640px]:p-6">
        <p role="alert">
          {t(
            status === 404
              ? 'teams.public.invalid'
              : status === 429
                ? 'teams.public.rateLimited'
                : 'errors.generic',
          )}
        </p>
      </Card>
    );
  }

  const lang = locale(i18n.language);
  const day = new Intl.DateTimeFormat(lang, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(new Date(meeting.startsAt));
  const time = new Intl.DateTimeFormat(lang, { hour: '2-digit', minute: '2-digit' });
  const span = `${time.format(new Date(meeting.startsAt))} – ${time.format(new Date(meeting.endsAt))}`;
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const notice = t(meeting.recorded ? 'teams.public.recorded' : 'teams.public.mayRecord');
  const description = `${notice}\n\n${t('teams.public.join')}: ${meeting.joinUrl}`;

  return (
    <Card className="mx-auto w-full max-w-[480px] gap-6 p-8 max-[640px]:p-6">
      <div className="flex items-start gap-4">
        <CalendarLeaf iso={meeting.startsAt} size={40} />
        <div className="flex min-w-0 flex-col gap-1">
          <h1 className="text-medium leading-tight font-semibold break-words">{meeting.title}</h1>
          <p className="text-body font-semibold first-letter:uppercase">{day}</p>
          <p className="text-body">{span}</p>
          <p className="text-tiny text-muted-foreground">{t('teams.public.timeZone', { zone })}</p>
        </div>
      </div>
      <p className="rounded-lg bg-secondary p-3 text-button font-semibold">{notice}</p>
      <div className="flex flex-col gap-2">
        <Button asChild>
          <a href={meeting.joinUrl} target="_blank" rel="noopener noreferrer" className="gap-1.5">
            {t('teams.public.join')}
            <ArrowOutIcon />
          </a>
        </Button>
        <div className="flex flex-wrap gap-2">
          <Button asChild variant="outline" size="sm">
            <a href={outlookLink(meeting, description)} target="_blank" rel="noopener noreferrer">
              {t('teams.public.outlook')}
            </a>
          </Button>
          <Button asChild variant="outline" size="sm">
            <a href={googleLink(meeting, description)} target="_blank" rel="noopener noreferrer">
              {t('teams.public.google')}
            </a>
          </Button>
          <Button asChild variant="outline" size="sm">
            <a href={icsLink(token, i18n.language)} download>
              {t('teams.public.ics')}
            </a>
          </Button>
        </div>
      </div>
    </Card>
  );
}
