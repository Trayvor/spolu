import { Component, Suspense, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { useTranslation } from 'react-i18next';
import { i18n, setLanguage } from '@/i18n';
import settingsEn from '@/locales/settings/en.json';
import settingsSk from '@/locales/settings/sk.json';
import {
  NAMESPACES,
  isNamespaceLoaded,
  loadNamespace,
  pendingLanguage,
  resetNamespaces,
  retryFailedNamespaces,
  setNamespaceImporter,
  useNamespaces,
  withNamespaces,
} from './namespaces';

// Every t() call on a key that is not there, in any render: a raw key reached the screen.
const missing: string[] = [];
const onMissing = (_lngs: readonly string[], _ns: string, key: string) => missing.push(key);

beforeEach(async () => {
  await setLanguage('en');
  resetNamespaces();
  missing.length = 0;
  i18n.options.saveMissing = true;
  i18n.on('missingKey', onMissing);
});
afterEach(() => {
  setNamespaceImporter(null);
  i18n.off('missingKey', onMissing);
  i18n.options.saveMissing = false;
  vi.restoreAllMocks();
});

describe('loadNamespace', () => {
  it('finds one namespace per folder in src/locales', () => {
    expect(NAMESPACES).toContain('settings');
    expect(NAMESPACES).toContain('notifications');
  });

  it('merges the file under its name into the default namespace', async () => {
    expect(i18n.exists('settings.profile.title')).toBe(false);
    await loadNamespace('settings');
    expect(isNamespaceLoaded('settings')).toBe(true);
    expect(i18n.t('settings.profile.title')).toBe(settingsEn.profile.title);
  });

  it('keeps the keys of the main locale files', async () => {
    const before = i18n.t('nav.settings');
    await loadNamespace('settings');
    expect(i18n.t('nav.settings')).toBe(before);
  });

  it('loads once when called twice at the same time or again later', async () => {
    const add = vi.spyOn(i18n, 'addResourceBundle');
    await Promise.all([loadNamespace('settings'), loadNamespace('settings')]);
    await loadNamespace('settings');
    expect(add).toHaveBeenCalledTimes(1);
  });

  it('rejects an unknown namespace', async () => {
    await expect(loadNamespace('nope')).rejects.toThrow('nope');
  });

  it('a language change loads the new language before any text switches', async () => {
    await loadNamespace('settings');
    const readyWhenChanged: boolean[] = [];
    const onChanged = (lng: string) =>
      readyWhenChanged.push(i18n.getResource(lng, 'translation', 'settings.profile.title') != null);
    i18n.on('languageChanged', onChanged);
    try {
      await setLanguage('sk');
    } finally {
      i18n.off('languageChanged', onChanged);
    }
    expect(readyWhenChanged).toEqual([true]);
    expect(i18n.t('settings.profile.title')).toBe(settingsSk.profile.title);
    expect(isNamespaceLoaded('settings', 'sk')).toBe(true);
  });

  it('a namespace asked for during a language change is loaded for the new language too', async () => {
    const change = setLanguage('sk');
    const load = loadNamespace('settings');
    await Promise.all([change, load]);
    expect(i18n.language).toBe('sk');
    expect(i18n.t('settings.profile.title')).toBe(settingsSk.profile.title);
  });
});

describe('withNamespaces', () => {
  it('resolves the module only once its namespaces are loaded', async () => {
    const importer = withNamespaces(['settings', 'notifications'], async () => {
      return { Page: () => null };
    });
    const module = await importer();
    expect(typeof module.Page).toBe('function');
    expect(isNamespaceLoaded('settings')).toBe(true);
    expect(isNamespaceLoaded('notifications')).toBe(true);
  });
});

describe('useNamespaces', () => {
  /** Each render: was the namespace there before and after the hook. */
  const renders: { before: boolean; after?: boolean }[] = [];
  function Probe() {
    const render: { before: boolean; after?: boolean } = { before: isNamespaceLoaded('settings') };
    renders.push(render);
    useNamespaces(['settings']);
    render.after = isNamespaceLoaded('settings');
    const { t } = useTranslation();
    return <p>{t('settings.profile.title')}</p>;
  }
  beforeEach(() => {
    renders.length = 0;
  });

  it('suspends until the namespace is loaded, so no raw key renders', async () => {
    render(
      <Suspense fallback={<p>loading</p>}>
        <Probe />
      </Suspense>,
    );
    expect(screen.getByText('loading')).toBeInTheDocument();
    // The load the hook started (shared); act lets React render again once it settles.
    await act(() => loadNamespace('settings'));
    expect(screen.getByText(settingsEn.profile.title)).toBeInTheDocument();
    expect(renders[0]).toEqual({ before: false }); // suspended in the hook
    expect(renders.every((r) => r.after !== false)).toBe(true);
    expect(missing).toEqual([]);
  });

  it('renders at once when the namespace is already loaded', async () => {
    await loadNamespace('settings');
    render(
      <Suspense fallback={<p>loading</p>}>
        <Probe />
      </Suspense>,
    );
    expect(screen.getByText(settingsEn.profile.title)).toBeInTheDocument();
    expect(renders).toEqual([{ before: true, after: true }]);
    expect(missing).toEqual([]);
  });
});

/** A real namespace file, through the real importer, once the test lets it go. */
function deferredImporter() {
  const real = async (name: string, lang: string) =>
    (await import(`../locales/${name}/${lang}.json`)) as { default: Record<string, unknown> };
  let release!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve));
  setNamespaceImporter(async (name, lang) => {
    await gate;
    return real(name, lang);
  });
  return release;
}

class Boundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  render() {
    if (this.state.error) {
      return (
        <p>
          failed: {this.state.error.message}
          <button type="button" onClick={() => this.setState({ error: null })}>
            again
          </button>
        </p>
      );
    }
    return this.props.children;
  }
}

describe('useNamespaces failures', () => {
  function Probe({ names }: { names: string[] }) {
    useNamespaces(names);
    const { t } = useTranslation();
    return <p>{t('settings.profile.title')}</p>;
  }
  const ui = (names: string[]) => (
    <Boundary>
      <Suspense fallback={<p>loading</p>}>
        <Probe names={names} />
      </Suspense>
    </Boundary>
  );
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined); // React logs caught errors
  });

  it('an unknown namespace throws to the error boundary at once', () => {
    render(ui(['nope']));
    expect(screen.getByText(/failed: .*nope/)).toBeInTheDocument();
  });

  it('a failed load reaches the error boundary instead of suspending forever', async () => {
    const importer = vi.fn(async () => {
      throw new Error('offline');
    });
    setNamespaceImporter(importer);
    render(ui(['settings']));
    expect(screen.getByText('loading')).toBeInTheDocument();
    await act(async () => {
      await loadNamespace('settings').catch(() => undefined);
    });
    expect(screen.getByText('failed: offline')).toBeInTheDocument();
    // Rendering again does not start a new load: the failure stays until an explicit retry.
    await act(async () => screen.getByRole('button', { name: 'again' }).click());
    expect(screen.getByText('failed: offline')).toBeInTheDocument();
    expect(importer).toHaveBeenCalledTimes(1);
  });

  it('retryFailedNamespaces lets the next render load again', async () => {
    setNamespaceImporter(async () => {
      throw new Error('offline');
    });
    render(ui(['settings']));
    await act(async () => {
      await loadNamespace('settings').catch(() => undefined);
    });
    expect(screen.getByText('failed: offline')).toBeInTheDocument();

    setNamespaceImporter(null);
    retryFailedNamespaces();
    screen.getByRole('button', { name: 'again' }).click();
    await act(() => loadNamespace('settings'));
    expect(await screen.findByText(settingsEn.profile.title)).toBeInTheDocument();
    expect(missing).toEqual([]);
  });
});

describe('language switch races', () => {
  it('sk→en then en→sk quickly ends in sk', async () => {
    await setLanguage('sk');
    resetNamespaces();
    await loadNamespace('settings'); // in sk only: a switch to en has to load it
    const release = deferredImporter();

    const toEn = setLanguage('en');
    expect(pendingLanguage()).toBe('en');
    const toSk = setLanguage('sk');
    release();
    expect(await toSk).toBe(true);
    expect(await toEn).toBe(false); // superseded: it never switches
    expect(i18n.language).toBe('sk');
    expect(localStorage.getItem('spolu.lang')).toBe('sk');
    expect(document.documentElement.lang).toBe('sk');
    expect(pendingLanguage()).toBe('sk');
  });

  it('a failed load rejects the switch and keeps the language', async () => {
    await setLanguage('sk');
    localStorage.setItem('spolu.lang', 'sk');
    resetNamespaces();
    await loadNamespace('settings');
    setNamespaceImporter(async () => {
      throw new Error('offline');
    });

    await expect(setLanguage('en')).rejects.toThrow('offline');
    expect(i18n.language).toBe('sk');
    expect(localStorage.getItem('spolu.lang')).toBe('sk');
    expect(document.documentElement.lang).toBe('sk');
    expect(pendingLanguage()).toBe('sk');
  });
});
