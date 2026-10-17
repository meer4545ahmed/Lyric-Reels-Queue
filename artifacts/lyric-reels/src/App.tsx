import { useEffect, useMemo, useRef, useState, type ChangeEvent, type FormEvent, type ReactNode } from 'react';
import { createClient, type User, type Session } from '@supabase/supabase-js';
import { Auth } from '@supabase/auth-ui-react';
import { ThemeSupa } from '@supabase/auth-ui-shared';
import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import { Link, Redirect, Route, Router as WouterRouter, Switch, useLocation } from 'wouter';
import {
  ArrowRight, Bell, Check, CheckCircle2, ChevronDown, Clock3,
  CloudUpload, Copy, Download, Film, FolderOpen, Headphones, LoaderCircle, LogOut,
  Menu, MoreHorizontal, Pencil, Play, Plus, RotateCw, SkipForward, Sparkles,
  Trash2, Upload, X, Facebook, ShieldCheck, CircleAlert,
} from 'lucide-react';
import {
  getGetFacebookStatusQueryKey, getGetSettingsQueryKey, getGetVideoFileUrlQueryKey,
  getListVideosQueryKey, useCreateVideo, useDeleteVideo,
  useDisconnectFacebook, useGetFacebookStatus, useSelectFacebookPage, useStartFacebookConnect,
  useGetSettings, useGetVideoFileUrl, useListVideos, useMarkVideoPosted,
  useRequestUploadUrl, useSkipVideo, useUpdateSettings, useUpdateVideo,
} from '@workspace/api-client-react';
import { setAuthTokenGetter } from '@workspace/api-client-react';
import type { FacebookStatus, ScheduleSettingsInput, Video, VideoInput } from '@workspace/api-client-react';
import './index.css';

// ─── Supabase client (browser / anon key) ────────────────────────────────────
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string;
if (!supabaseUrl || !supabaseAnonKey) throw new Error('Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY');
export const supabase = createClient(supabaseUrl, supabaseAnonKey);

// Wire the Supabase session token into every API request so the backend
// requireAuth middleware can verify it via supabase.auth.getUser(token).
setAuthTokenGetter(async () => {
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? null;
});

// ─── React Query client ───────────────────────────────────────────────────────
const queryClient = new QueryClient();

// ─── Helpers ─────────────────────────────────────────────────────────────────
const basePath = import.meta.env.BASE_URL.replace(/\/$/, '');
const formatBytes = (bytes: number) => bytes >= 1_000_000_000 ? `${(bytes / 1_000_000_000).toFixed(1)} GB` : `${(bytes / 1_000_000).toFixed(0)} MB`;
const readableDate = (value?: string | null) => value ? new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value)) : 'Not yet';
const timezoneChoices = (() => { try { return Intl.supportedValuesOf('timeZone'); } catch { return ['America/Los_Angeles', 'America/New_York', 'Europe/London', 'Asia/Tokyo', 'UTC']; } })();

// ─── Auth context ─────────────────────────────────────────────────────────────
// Simple React context so every component can read the current user
// without prop-drilling.
import { createContext, useContext } from 'react';
const AuthCtx = createContext<{ user: User | null; session: Session | null }>({ user: null, session: null });
function useAuth() { return useContext(AuthCtx); }

// ─── Logo ────────────────────────────────────────────────────────────────────
function Logo({ inverse = false }: { inverse?: boolean }) {
  return <Link href="/" className={`brand ${inverse ? 'brand-light' : ''}`} aria-label="Reelkeeper home"><span className="brand-mark"><Film size={17} strokeWidth={1.7} /></span><span>reelkeeper<span className="brand-period">.</span></span></Link>;
}

// ─── Button ───────────────────────────────────────────────────────────────────
function Button({ children, onClick, variant = 'primary', disabled, type = 'button', className = '', ...props }: {
  children: ReactNode; onClick?: () => void; variant?: 'primary' | 'quiet' | 'outline' | 'danger'; disabled?: boolean; type?: 'button' | 'submit'; className?: string; [key: string]: unknown;
}) {
  return <button type={type} onClick={onClick} disabled={disabled} className={`button button-${variant} ${className}`} {...props}>{children}</button>;
}

// ─── AppFrame ─────────────────────────────────────────────────────────────────
function AppFrame({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  const { user } = useAuth();
  const settings = useGetSettings();
  const list = useListVideos();
  const [clock, setClock] = useState(Date.now());
  const [mobileOpen, setMobileOpen] = useState(false);
  useEffect(() => {
    const timer = window.setInterval(() => setClock(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);
  const nextPostAt = settings.data?.nextPostAt;
  const reminderDue = Boolean(settings.data?.enabled && nextPostAt && Date.parse(nextPostAt) <= clock);
  const nextVideo = list.data?.videos.find((v) => v.isNext);
  useEffect(() => {
    if (!reminderDue || !nextPostAt || !user?.id || !('Notification' in window)) return;
    if (Notification.permission !== 'granted') return;
    const key = `reelkeeper-reminder:${user.id}:${nextPostAt}`;
    if (localStorage.getItem(key) === 'sent') return;
    new Notification('Your next lyric video is ready', {
      body: nextVideo?.title ? `Time to share "${nextVideo.title}" when you're ready.` : 'Your posting reminder is due.',
      icon: `${basePath}/logo.svg`,
    });
    localStorage.setItem(key, 'sent');
  }, [reminderDue, nextPostAt, user?.id, nextVideo?.title]);
  const displayName = user?.user_metadata?.full_name || user?.email?.split('@')[0] || 'Your studio';
  const initials = displayName[0]?.toUpperCase() || 'R';
  const signOut = () => supabase.auth.signOut();
  const nav = [
    { href: '/', label: 'Today', icon: Sparkles },
    { href: '/library', label: 'Your library', icon: FolderOpen },
    { href: '/schedule', label: 'Reminder rhythm', icon: Clock3 },
  ];
  return <div className="app-frame grain">
    <aside className={`sidebar ${mobileOpen ? 'sidebar-open' : ''}`}>
      <div className="sidebar-top"><Logo inverse /><button className="icon-button sidebar-close" aria-label="Close menu" onClick={() => setMobileOpen(false)}><X size={18} /></button></div>
      <div className="sidebar-caption">YOUR SPACE</div>
      <nav className="side-nav" aria-label="Main navigation">
        {nav.map(({ href, label, icon: Icon }) => (
          <Link key={href} href={href} className={`side-link ${location === href ? 'side-link-active' : ''}`} onClick={() => setMobileOpen(false)}>
            <Icon size={17} strokeWidth={1.8} /><span>{label}</span>{href === '/library' && <span className="side-arrow">↗</span>}
          </Link>
        ))}
      </nav>
      <div className="sidebar-spacer" />
      <div className="sidebar-note"><span className="note-mark">"</span><p>Make room for the work that wants to be seen.</p><span className="note-byline">A LITTLE REMINDER</span></div>
      <div className="profile-row">
        <span className="profile-avatar">{initials}</span>
        <span className="profile-copy"><strong>{displayName}</strong><small>Private creator space</small></span>
        <button className="icon-button logout-button" aria-label="Sign out" title="Sign out" onClick={signOut}><LogOut size={16} /></button>
      </div>
    </aside>
    {mobileOpen && <button className="mobile-scrim" aria-label="Close navigation" onClick={() => setMobileOpen(false)} />}
    <main className="main-area">
      <header className="mobile-header"><button className="icon-button" aria-label="Open menu" onClick={() => setMobileOpen(true)}><Menu size={20} /></button><Logo /><div className="mobile-header-spacer" /></header>
      <div className="page-content">
        {reminderDue && <div className="due-banner" role="status"><Bell size={17} /><span><strong>Your reminder is due.</strong> {nextVideo ? `"${nextVideo.title}" is next in your rotation.` : 'Your next video is ready.'} Posting stays manual.</span><Link href="/" className="text-link">Open today <ArrowRight size={14} /></Link></div>}
        {children}
      </div>
    </main>
  </div>;
}

// ─── Auth pages (Sign in / Sign up) ──────────────────────────────────────────
function AuthPage({ mode }: { mode: 'sign_in' | 'sign_up' }) {
  return (
    <div className="auth-page grain">
      <div className="auth-aside">
        <Logo inverse />
        <div>
          <span className="section-index">{mode === 'sign_in' ? 'YOUR WORK, IN ITS OWN LITTLE HOME' : 'A SPACE THAT MOVES AT YOUR SPEED'}</span>
          <h1>{mode === 'sign_in' ? <>Come back<br /><em>to your songs.</em></> : <>Start with<br /><em>what you made.</em></>}</h1>
          <p>{mode === 'sign_in' ? 'A calm place to keep the next lyric video close.' : 'Let a little rhythm take care of the remembering.'}</p>
        </div>
        <span className="auth-quote">{mode === 'sign_in' ? '"Keep making things that sound like you."' : '"A good loop deserves another listen."'}</span>
      </div>
      <div className="auth-content">
        <Auth
          supabaseClient={supabase}
          view={mode === 'sign_in' ? 'sign_in' : 'sign_up'}
          appearance={{
            theme: ThemeSupa,
            variables: {
              default: {
                colors: {
                  brand: '#315d53',
                  brandAccent: '#24483f',
                  inputBackground: '#f8f4eb',
                  inputBorder: '#d9d3c6',
                  inputText: '#263d38',
                  inputPlaceholder: '#71817c',
                },
                radii: { borderRadiusButton: '0.8rem', inputBorderRadius: '0.8rem' },
                fonts: { bodyFontFamily: 'DM Sans', buttonFontFamily: 'DM Sans' },
              },
            },
          }}
          providers={['facebook']}
          redirectTo={`${window.location.origin}${basePath}/`}
          socialLayout="vertical"
          localization={{
            variables: {
              sign_in: { email_label: 'Your email', password_label: 'Password', button_label: 'Sign in', social_provider_text: 'Continue with {{provider}}' },
              sign_up: { email_label: 'Your email', password_label: 'Create a password', button_label: 'Create your space', social_provider_text: 'Continue with {{provider}}' },
            },
          }}
        />
        {mode === 'sign_up' && <p className="owner-claim-note">This is a one-creator space. The first account to sign in becomes its owner.</p>}
      </div>
    </div>
  );
}

// ─── Landing page ─────────────────────────────────────────────────────────────
function Landing() {
  return <div className="landing grain">
    <header className="landing-nav"><Logo /><Link href="/sign-in" className="landing-signin">Sign in <ArrowRight size={15} /></Link></header>
    <section className="hero-section">
      <div className="hero-copy animate-rise"><div className="eyebrow"><span className="eyebrow-dot" /> A QUIETER WAY TO KEEP THE CYCLE MOVING</div><h1>Your words.<br /><em>In rotation.</em></h1><p className="hero-lede">A private little home for your lyric videos — with a dependable posting rhythm when you want one.</p><div className="hero-actions"><Link href="/sign-up" className="button button-primary">Make your space <ArrowRight size={16} /></Link><span className="private-note"><span className="tiny-lock">PRIVATE</span> Just for you. Always.</span></div></div>
      <div className="hero-art animate-rise delay-1" aria-label="Abstract artwork of a film frame and sunlit lyric lines"><div className="art-orbit orbit-one" /><div className="art-orbit orbit-two" /><div className="art-sun" /><div className="art-frame"><div className="frame-perf perf-top" /><div className="frame-center"><span className="frame-label">SIDE A — TRACK 04</span><div className="lyric-lines"><span>the light keeps</span><em>finding its way</em><span>back to me</span></div><div className="sound-wave"><i /><i /><i /><i /><i /><i /><i /><i /><i /><i /><i /><i /><i /><i /><i /><i /><i /><i /><i /><i /><i /></div><span className="frame-time">00:18 <b>/</b> 00:42</span></div><div className="frame-perf perf-bottom" /></div><div className="floating-note">a loop worth keeping <span>↗</span></div><div className="art-index">01 / YOUR NEXT CHAPTER</div></div>
      <div className="hero-footnote"><span>01</span><span>BUILT FOR ONE CREATOR, ONE GOOD LOOP AT A TIME</span><span>SCROLL TO SEE THE RHYTHM ↓</span></div>
    </section>
    <section className="manifesto-section"><div className="section-index">THE IDEA / 01</div><div className="manifesto-copy"><p className="manifesto-kicker">Less juggling. More making.</p><h2>Keep the videos close.<br /><em>Keep the ritual simple.</em></h2><p className="manifesto-desc">Reelkeeper remembers what's in the mix, what's next, and when you meant to come back. The posting stays yours — always a human, always your call.</p></div><div className="manifesto-stamp"><span>YOUR<br />OWN<br /><em>PACE</em></span><div className="stamp-ring">PRIVATE • PERSONAL • YOURS •</div></div></section>
    <section className="flow-section"><div className="flow-heading"><div className="section-index">A SMALL, LOVELY LOOP / 02</div><h2>From finished file<br />to <em>ready when you are.</em></h2></div><div className="flow-rail"><div className="flow-step"><span className="flow-number">01</span><div className="flow-icon"><CloudUpload size={20} /></div><h3>Drop it in</h3><p>Keep your big, beautiful video files in one private library. Add the title and caption while the moment is fresh.</p><span className="flow-caption">MULTIPLE FILES, UP TO 2 GB EACH</span></div><div className="flow-connector"><span>→</span></div><div className="flow-step"><span className="flow-number">02</span><div className="flow-icon"><RotateCw size={20} /></div><h3>Let the queue breathe</h3><p>Your videos move through a simple first-in, first-out rotation. The next one is never a guessing game.</p><span className="flow-caption">A QUEUE THAT REMEMBERS</span></div><div className="flow-connector"><span>→</span></div><div className="flow-step"><span className="flow-number">03</span><div className="flow-icon"><Headphones size={20} /></div><h3>Set the rhythm</h3><p>Connect a Facebook Page to schedule the next video every three hours. Pause it whenever you need room.</p><span className="flow-caption">A SIMPLE, OPTIONAL SCHEDULE</span></div></div></section>
    <section className="honesty-section"><div className="honesty-asterisk"><ShieldCheck size={28} /></div><div><span className="section-index">A NOTE ON HOW THIS WORKS</span><h2>A steady cycle.<br /><em>Clear, optional access.</em></h2><p>Connect a Facebook Page to use the scheduled three-hour rhythm. You can pause it whenever you like. View insights are optional and won't block publishing.</p></div><div className="manual-card"><span className="manual-check"><Check size={18} /></span><strong>Your Page, your choice.</strong><small>Choose a connected Page or disconnect it at any time.</small><div className="manual-status"><span /> ONE CREATOR · ONE QUEUE</div></div></section>
    <section className="closing-section"><div className="closing-decoration">R<br />K</div><span className="section-index">MAKE THE NEXT ONE COUNT / 03</span><h2>Make a little<br /><em>room for your songs.</em></h2><Link href="/sign-up" className="button button-primary">Start your private queue <ArrowRight size={16} /></Link><p>One creator. One private space. A rhythm you can pause.</p></section>
    <footer className="landing-footer"><Logo /><span>A private queue for the things you make.</span><span>© REELKEEPER — MADE FOR THE MOMENT BEFORE SHARE</span></footer>
  </div>;
}

// ─── Route guards ─────────────────────────────────────────────────────────────
function HomeRoute() {
  const { user } = useAuth();
  return user ? <Redirect to="/today" /> : <Landing />;
}
function TodayRoute() {
  const { user } = useAuth();
  return user ? <Dashboard /> : <Redirect to="/" />;
}
function LibraryRoute() {
  const { user } = useAuth();
  return user ? <LibraryPage /> : <Redirect to="/" />;
}
function ScheduleRoute() {
  const { user } = useAuth();
  return user ? <SchedulePage /> : <Redirect to="/" />;
}

// ─── Shared UI ────────────────────────────────────────────────────────────────
function PageHeading({ eyebrow, title, detail, action }: { eyebrow: string; title: string; detail: string; action?: ReactNode }) {
  return <div className="page-heading animate-rise"><div><div className="eyebrow"><span className="eyebrow-dot" />{eyebrow}</div><h1>{title}</h1><p>{detail}</p></div>{action && <div className="heading-action">{action}</div>}</div>;
}
function QueryError({ retry }: { retry: () => void }) {
  return <div className="error-panel"><span className="error-icon"><RotateCw size={19} /></span><strong>We couldn&apos;t open this page just now.</strong><span>Give it another try. Your library is still safe.</span><Button variant="outline" onClick={retry}>Try again</Button></div>;
}
function SkeletonRows() {
  return <div className="skeleton-list" aria-label="Loading your videos">{[1, 2, 3].map(n => <div key={n} className="skeleton-row"><span className="skeleton-thumb" /><span className="skeleton-lines"><i /><i /></span><span className="skeleton-pill" /></div>)}</div>;
}
function Notice({ message, tone = 'success', onDismiss }: { message: string; tone?: 'success' | 'error'; onDismiss: () => void }) {
  return <div className={`notice notice-${tone}`} role="status"><span>{tone === 'success' ? <CheckCircle2 size={17} /> : <X size={17} />}</span>{message}<button className="icon-button" aria-label="Dismiss notification" onClick={onDismiss}><X size={15} /></button></div>;
}

// ─── Dashboard ────────────────────────────────────────────────────────────────
function Dashboard() {
  const list = useListVideos();
  const settings = useGetSettings();
  const facebook = useGetFacebookStatus();
  const mark = useMarkVideoPosted();
  const skip = useSkipVideo();
  const { user } = useAuth();
  const client = useQueryClient();
  const [notice, setNotice] = useState('');
  const videos = list.data?.videos || [];
  const nextVideo = videos.find(v => v.isNext) || videos[0];
  const syncList = (data?: { videos: Video[] }) => data && client.setQueryData(getListVideosQueryKey(), data);
  const act = (kind: 'posted' | 'skip') => {
    if (!nextVideo) return;
    const action = kind === 'posted' ? mark : skip;
    action.mutate({ id: nextVideo.id }, {
      onSuccess: data => { syncList(data); setNotice(kind === 'posted' ? 'Marked as posted. The queue has moved on.' : 'Skipped for this pass. The queue has moved on.'); },
      onError: () => setNotice('That didn\u2019t go through. Please try once more.'),
    });
  };
  const firstName = (user?.user_metadata?.full_name as string | undefined)?.split(' ')[0] || user?.email?.split('@')[0] || 'there';
  const nextAt = settings.data?.nextPostAt;
  const hoursLeft = nextAt ? Math.max(0, Math.ceil((new Date(nextAt).getTime() - Date.now()) / 3_600_000)) : null;
  const fbStatus = facebook.data;
  const autoPostingOn = !!(fbStatus?.autoPostingEnabled && fbStatus?.connected && settings.data?.enabled);
  return <AppFrame>
    <div className="home-topline"><span>YOUR PRIVATE CREATOR SPACE</span><span className="date-mark">{new Intl.DateTimeFormat(undefined, { weekday: 'long', month: 'long', day: 'numeric' }).format(new Date())}</span></div>
    <div className="welcome-block animate-rise"><div><p className="welcome-label">A good day to make something</p><h1>Hello, {firstName}<span className="accent-dot">.</span></h1><p className="welcome-subtitle">Your videos are here. The next step is yours.</p></div><div className="welcome-scribble" aria-hidden="true">RK</div></div>
    {notice && <Notice message={notice} tone={notice.includes('didn\u2019t') ? 'error' : 'success'} onDismiss={() => setNotice('')} />}
    <section className="next-section animate-rise delay-1">
      <div className="section-topline"><div><span className="section-index">01 / UP NEXT</span><h2>Ready when you are</h2></div><Link href="/library" className="text-link">See the whole library <ArrowRight size={15} /></Link></div>
      {list.isLoading ? <div className="next-skeleton"><span className="next-skeleton-image" /><span className="skeleton-lines"><i /><i /></span></div> : list.isError ? <QueryError retry={() => list.refetch()} /> : nextVideo
        ? <div className="feature-card">
            <div className="feature-art"><div className="film-rail" /><div className="feature-art-content"><span className="feature-tag"><span /> NEXT IN ROTATION</span><span className="feature-no">{String(nextVideo.postedCount + 1).padStart(2, '0')}</span><div className="feature-wave">{Array.from({ length: 39 }, (_, i) => <i key={i} style={{ height: `${12 + ((i * 31 + 17) % 57)}%` }} />)}</div><span className="feature-reel">A REELKEEPER SELECTION</span></div></div>
            <div className="feature-details">
              <div className="feature-description">
                <span className="detail-label">UP NEXT IN YOUR ROTATION</span>
                <h3>{nextVideo.title}</h3>
                <p>{nextVideo.description || 'No caption yet. Add a little context in your library whenever you like.'}</p>
                <div className="feature-meta"><span><RotateCw size={14} /> Posted {nextVideo.postedCount} {nextVideo.postedCount === 1 ? 'time' : 'times'}</span><span><Clock3 size={14} /> {hoursLeft === null ? 'Reminder not set' : hoursLeft === 0 ? 'Reminder is due' : `Reminder in about ${hoursLeft}h`}</span></div>
              </div>
              <div className="feature-actions">
                <Button onClick={() => act('posted')} disabled={mark.isPending || skip.isPending} className="posted-button">{mark.isPending ? <LoaderCircle size={16} className="spin" /> : <Check size={16} />} Mark as posted</Button>
                <Button variant="outline" onClick={() => act('skip')} disabled={mark.isPending || skip.isPending}><SkipForward size={15} /> Skip this one</Button>
                <p>{autoPostingOn ? 'Auto-posting is active. Reels post every 3 hours.' : 'Connect Facebook on the Schedule page to enable auto-posting.'}</p>
              </div>
            </div>
          </div>
        : <div className="empty-feature"><div className="empty-film"><Film size={24} /></div><span className="section-index">A FRESH FRAME IS WAITING</span><h3>Your rotation starts with one video.</h3><p>Add a lyric video and it&apos;ll be right here when you&apos;re ready to share.</p><Link href="/library" className="button button-primary"><Plus size={16} /> Add your first video</Link></div>}
    </section>
    <section className="dashboard-bottom animate-rise delay-2">
      <div className="rhythm-card">
        <div className="rhythm-head"><div><span className="section-index">02 / AUTO-POSTING</span><h3>{autoPostingOn ? 'Reels are posting' : 'Posting schedule'}</h3></div>{autoPostingOn ? <Facebook size={18} /> : <Clock3 size={18} />}</div>
        {settings.isLoading || facebook.isLoading ? <div className="rhythm-skeleton"><i /><i /></div> : settings.isError ? <p className="rhythm-caption">We couldn&apos;t check your settings.</p>
          : <><div className="rhythm-value">{autoPostingOn ? `${settings.data?.intervalHours ?? 3}h` : settings.data?.enabled ? `${settings.data.intervalHours}h` : 'Paused'}<span>{autoPostingOn ? 'auto-posting to Facebook' : settings.data?.enabled ? 'schedule on, connect Facebook' : 'schedule paused'}</span></div>
            <div className={`schedule-status ${autoPostingOn || settings.data?.enabled ? 'status-on' : 'status-off'}`}><span />{autoPostingOn ? 'AUTO-POSTING' : settings.data?.enabled ? 'SCHEDULE ON' : 'PAUSED'}</div>
            {fbStatus?.lastError && <p className="rhythm-caption fb-error-caption"><CircleAlert size={13} /> {fbStatus.lastError}</p>}
            {!fbStatus?.lastError && <p className="rhythm-caption">{autoPostingOn && settings.data?.nextPostAt ? `Next Reel: ${readableDate(settings.data.nextPostAt)}` : !fbStatus?.connected ? 'Connect a Facebook Page on the Schedule page.' : settings.data?.nextPostAt ? `Next post: ${readableDate(settings.data.nextPostAt)}` : 'Set a schedule to start posting.'}</p>}
          </>}
        <Link href="/schedule" className="text-link">Manage schedule <ArrowRight size={14} /></Link>
      </div>
      <div className="library-glance">
        <div className="glance-heading"><div><span className="section-index">03 / RECENTLY ADDED</span><h3>From your library</h3></div><Link href="/library" className="text-link">View all <ArrowRight size={14} /></Link></div>
        {list.isLoading ? <SkeletonRows /> : list.isError ? <p className="subtle">Your recent videos aren&apos;t available right now.</p> : videos.length
          ? <div className="recent-list">{videos.slice(0, 3).map((video, i) => <div className="recent-item" key={video.id}><span className={`recent-index recent-color-${i % 3}`}>{String(i + 1).padStart(2, '0')}</span><span className="recent-copy"><strong>{video.title}</strong><small>{video.originalFilename}</small></span>{video.isNext && <span className="mini-next">NEXT</span>}</div>)}</div>
          : <div className="recent-empty">Your new additions will find a home here.</div>}
      </div>
    </section>
    <div className="manual-footnote"><span className="manual-dot" /> {autoPostingOn ? 'Reels are posting automatically every 3 hours to your Facebook Page.' : 'Connect a Facebook Page on the Schedule page to enable auto-posting.'}</div>
  </AppFrame>;
}

// ─── Library ──────────────────────────────────────────────────────────────────
type DraftVideo = { file: File; title: string; description: string; progress: number; status: 'queued' | 'uploading' | 'done' | 'error'; error?: string };

function LibraryPage() {
  const list = useListVideos();
  const requestUpload = useRequestUploadUrl();
  const createVideo = useCreateVideo();
  const update = useUpdateVideo();
  const remove = useDeleteVideo();
  const mark = useMarkVideoPosted();
  const skip = useSkipVideo();
  const client = useQueryClient();
  const [drafts, setDrafts] = useState<DraftVideo[]>([]);
  const [modal, setModal] = useState<'upload' | 'edit' | 'delete' | 'preview' | null>(null);
  const [editVideo, setEditVideo] = useState<Video | null>(null);
  const [deleteVideo, setDeleteVideo] = useState<Video | null>(null);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [notice, setNotice] = useState('');
  const [filter, setFilter] = useState<'all' | 'next'>('all');
  const [previewId, setPreviewId] = useState(0);
  const previewQuery = useGetVideoFileUrl(previewId, { query: { enabled: previewId > 0, queryKey: getGetVideoFileUrlQueryKey(previewId) } });
  const videos = list.data?.videos || [];
  const visible = filter === 'next' ? videos.filter(v => v.isNext) : videos;
  const invalidate = () => client.invalidateQueries({ queryKey: getListVideosQueryKey() });
  const addFiles = (files: FileList | null) => {
    if (!files) return;
    const next: DraftVideo[] = Array.from(files).filter(f => f.type.startsWith('video/')).map(f => ({ file: f, title: f.name.replace(/\.[^.]+$/, '').slice(0, 120), description: '', progress: 0, status: 'queued' }));
    setDrafts(cur => [...cur, ...next]);
    setModal('upload');
  };
  const setDraft = (i: number, key: 'title' | 'description', value: string) => setDrafts(old => old.map((d, j) => j === i ? { ...d, [key]: value } : d));
  const uploadAll = async () => {
    for (let i = 0; i < drafts.length; i++) {
      const draft = drafts[i];
      if (draft.status === 'done') continue;
      if (!draft.title.trim()) { setDrafts(old => old.map((d, j) => j === i ? { ...d, error: 'Add a title before uploading.' } : d)); return; }
      try {
        setDrafts(old => old.map((d, j) => j === i ? { ...d, status: 'uploading', progress: 5, error: undefined } : d));
        const contentType = draft.file.type || 'video/mp4';
        const { uploadURL, objectPath } = await requestUpload.mutateAsync({ data: { name: draft.file.name, size: draft.file.size, contentType } });
        await new Promise<void>((resolve, reject) => {
          const xhr = new XMLHttpRequest();
          xhr.open('PUT', uploadURL);
          xhr.setRequestHeader('Content-Type', contentType);
          xhr.upload.onprogress = e => { if (e.lengthComputable) setDrafts(old => old.map((d, j) => j === i ? { ...d, progress: Math.round(e.loaded / e.total * 88) } : d)); };
          xhr.onload = () => xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(`Upload failed (${xhr.status}).`));
          xhr.onerror = () => reject(new Error('The upload connection was interrupted.'));
          xhr.send(draft.file);
        });
        const input: VideoInput = { title: draft.title.trim(), description: draft.description, originalFilename: draft.file.name, objectPath, mimeType: contentType, sizeBytes: draft.file.size };
        await createVideo.mutateAsync({ data: input });
        setDrafts(old => old.map((d, j) => j === i ? { ...d, status: 'done', progress: 100 } : d));
        await invalidate();
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'This video could not be uploaded.';
        setDrafts(old => old.map((d, j) => j === i ? { ...d, status: 'error', error: msg } : d));
        return;
      }
    }
    setNotice('Your videos are safely in the library.');
  };
  const closeUpload = () => { setModal(null); setDrafts([]); };
  const beginEdit = (v: Video) => { setEditVideo(v); setTitle(v.title); setDescription(v.description); setModal('edit'); };
  const submitEdit = (e: FormEvent) => { e.preventDefault(); if (!editVideo) return; update.mutate({ id: editVideo.id, data: { title: title.trim(), description } }, { onSuccess: () => { setModal(null); setNotice('Video details saved.'); invalidate(); }, onError: () => setNotice('We couldn\u2019t save those details. Try again.') }); };
  const confirmDelete = () => { if (!deleteVideo) return; remove.mutate({ id: deleteVideo.id }, { onSuccess: () => { setModal(null); setNotice('Video removed from your library.'); invalidate(); }, onError: () => setNotice('We couldn\u2019t remove this video. Try again.') }); };
  const playVideo = (v: Video) => { setPreviewId(v.id); setModal('preview'); };
  return <AppFrame>
    <PageHeading eyebrow="YOUR PRIVATE ARCHIVE" title="Your library" detail="Every lyric video in its own little place."
      action={<label className="button button-primary upload-trigger"><Plus size={16} /> Add videos<input data-testid="input-upload-videos" type="file" accept="video/*" multiple hidden onChange={(e: ChangeEvent<HTMLInputElement>) => { addFiles(e.target.files); e.target.value = ''; }} /></label>} />
    {notice && <Notice message={notice} tone={notice.includes('\u2019') ? 'error' : 'success'} onDismiss={() => setNotice('')} />}
    <div className="library-toolbar">
      <div className="library-stats"><span className="library-count">{videos.length.toString().padStart(2, '0')}</span><span>VIDEO{videos.length === 1 ? '' : 'S'} IN THE ROTATION</span></div>
      <div className="filter-tabs" role="group" aria-label="Filter videos">
        <button className={filter === 'all' ? 'filter-active' : ''} onClick={() => setFilter('all')}>Everything <span>{videos.length}</span></button>
        <button className={filter === 'next' ? 'filter-active' : ''} onClick={() => setFilter('next')}>Up next <span>{videos.filter(v => v.isNext).length}</span></button>
      </div>
    </div>
    {list.isLoading ? <SkeletonRows /> : list.isError ? <QueryError retry={() => list.refetch()} /> : visible.length
      ? <div className="library-grid">{visible.map((video, idx) => <VideoCard key={video.id} video={video} index={idx} onEdit={() => beginEdit(video)} onDelete={() => { setDeleteVideo(video); setModal('delete'); }} onPreview={() => playVideo(video)} onPosted={() => mark.mutate({ id: video.id }, { onSuccess: data => { client.setQueryData(getListVideosQueryKey(), data); setNotice('Marked as posted. Queue advanced.'); }, onError: () => setNotice('Unable to update posting status.') })} onSkip={() => skip.mutate({ id: video.id }, { onSuccess: data => { client.setQueryData(getListVideosQueryKey(), data); setNotice('Skipped for this pass.'); }, onError: () => setNotice('Unable to skip this video.') })} busy={mark.isPending || skip.isPending} />)}</div>
      : filter === 'all'
        ? <div className="library-empty"><div className="empty-film"><Film size={23} /></div><span className="section-index">A LITTLE SPACE FOR WHAT YOU MAKE</span><h2>Your library is waiting.</h2><p>Add a lyric video to start your rotation. Big files are welcome — uploads go straight to private storage.</p><label className="button button-primary upload-trigger"><CloudUpload size={16} /> Choose video files<input type="file" accept="video/*" multiple hidden onChange={(e: ChangeEvent<HTMLInputElement>) => { addFiles(e.target.files); e.target.value = ''; }} /></label><small>Video files up to 2 GB each</small></div>
        : <div className="library-empty compact-empty"><h2>Nothing is up next just yet.</h2><p>Your rotation will bring the next video here.</p><Button variant="outline" onClick={() => setFilter('all')}>Show everything</Button></div>}
    <div className="upload-note"><CloudUpload size={16} /><span>Large files are uploaded directly to private storage. Reelkeeper keeps the queue and your captions close.</span><span className="upload-limit">UP TO 2 GB / VIDEO</span></div>
    {modal === 'upload' && <Modal title="Add to your rotation" subtitle="A title and description for each video keeps posting day simple." onClose={closeUpload} wide>
      <div className="draft-list">{drafts.map((draft, i) => <div className="draft-item" key={`${draft.file.name}-${i}`}>
        <div className="draft-file"><span className="draft-icon"><Film size={17} /></span><span><strong>{draft.file.name}</strong><small>{formatBytes(draft.file.size)} · {draft.status === 'done' ? 'Added to library' : draft.status === 'uploading' ? `Uploading · ${draft.progress}%` : draft.status === 'error' ? 'Upload needs attention' : 'Ready to upload'}</small></span>{draft.status !== 'uploading' && draft.status !== 'done' && <button aria-label={`Remove ${draft.file.name}`} className="icon-button" onClick={() => setDrafts(old => old.filter((_, j) => j !== i))}><X size={16} /></button>}{draft.status === 'done' && <CheckCircle2 className="done-check" size={18} />}</div>
        <div className="draft-fields"><label>REEL TITLE<input maxLength={120} value={draft.title} onChange={e => setDraft(i, 'title', e.target.value)} placeholder="Give this video a name" /></label><label>DESCRIPTION <span className="optional">(OPTIONAL)</span><textarea maxLength={5000} rows={2} value={draft.description} onChange={e => setDraft(i, 'description', e.target.value)} placeholder="A caption to keep with the video" /></label></div>
        {draft.status === 'uploading' && <div className="upload-progress"><span style={{ width: `${draft.progress}%` }} /></div>}
        {draft.error && <p className="field-error">{draft.error}</p>}
      </div>)}</div>
      <label className="add-more"><Plus size={15} /> Add more files<input type="file" accept="video/*" multiple hidden onChange={(e: ChangeEvent<HTMLInputElement>) => { addFiles(e.target.files); e.target.value = ''; }} /></label>
      <div className="modal-foot"><p>Files up to 2 GB · Uploads may take a little while.</p><div><Button variant="quiet" onClick={closeUpload}>Close</Button><Button onClick={uploadAll} disabled={!drafts.some(d => d.status !== 'done') || requestUpload.isPending || createVideo.isPending}>{requestUpload.isPending || createVideo.isPending ? <><LoaderCircle size={15} className="spin" /> Uploading</> : <><Upload size={15} /> Upload {drafts.filter(d => d.status !== 'done').length} {drafts.filter(d => d.status !== 'done').length === 1 ? 'video' : 'videos'}</>}</Button></div></div>
    </Modal>}
    {modal === 'edit' && <Modal title="Edit video details" subtitle="A small note for the next time this one is ready." onClose={() => setModal(null)}>
      <form className="edit-form" onSubmit={submitEdit}><label>REEL TITLE<input required maxLength={120} value={title} onChange={e => setTitle(e.target.value)} autoFocus /></label><label>DESCRIPTION<textarea maxLength={5000} rows={5} value={description} onChange={e => setDescription(e.target.value)} placeholder="A caption or a thought to keep with it" /></label><div className="modal-foot"><Button variant="quiet" onClick={() => setModal(null)}>Cancel</Button><Button type="submit" disabled={update.isPending}>{update.isPending ? <LoaderCircle size={15} className="spin" /> : <Check size={15} />} Save changes</Button></div></form>
    </Modal>}
    {modal === 'delete' && deleteVideo && <Modal title="Remove this video?" subtitle="This takes it out of your library and rotation. You can add it again later." onClose={() => setModal(null)}>
      <div className="delete-preview"><span className="draft-icon"><Trash2 size={17} /></span><span><strong>{deleteVideo.title}</strong><small>{deleteVideo.originalFilename}</small></span></div>
      <div className="modal-foot"><Button variant="quiet" onClick={() => setModal(null)}>Keep video</Button><Button variant="danger" onClick={confirmDelete} disabled={remove.isPending}>{remove.isPending ? <LoaderCircle size={15} className="spin" /> : <Trash2 size={15} />} Remove video</Button></div>
    </Modal>}
    {modal === 'preview' && <Modal title={videos.find(v => v.id === previewId)?.title || 'Your video'} subtitle="A private preview, just for you." onClose={() => { setModal(null); setPreviewId(0); }} wide>
      {previewQuery.isLoading ? <div className="preview-loading"><span /><p>Getting your video ready…</p></div>
        : previewQuery.isError ? <div className="error-panel"><strong>We couldn&apos;t open this video.</strong><span>Try again in a moment.</span><Button variant="outline" onClick={() => previewQuery.refetch()}>Try again</Button></div>
        : previewQuery.data?.url ? <><video className="video-preview" src={previewQuery.data.url} controls playsInline autoPlay /><a className="button button-outline preview-download" href={previewQuery.data.url} download={videos.find(v => v.id === previewId)?.originalFilename || 'lyric-video.mp4'}><Download size={15} /> Download video</a></>
        : <div className="preview-loading"><p>Waiting for your private preview…</p></div>}
    </Modal>}
  </AppFrame>;
}

// ─── Video card ───────────────────────────────────────────────────────────────
function VideoCard({ video, index, onEdit, onDelete, onPreview, onPosted, onSkip, busy }: { video: Video; index: number; onEdit: () => void; onDelete: () => void; onPreview: () => void; onPosted: () => void; onSkip: () => void; busy: boolean }) {
  const [actionsOpen, setActionsOpen] = useState(false);
  return <article className="video-card animate-rise" style={{ animationDelay: `${Math.min(index, 5) * 65}ms` }} data-testid={`card-video-${video.id}`}>
    <div className={`video-cover cover-${index % 4}`}><div className="cover-film-edge" /><span className="cover-number">{String(index + 1).padStart(2, '0')}</span><div className="cover-wave">{Array.from({ length: 27 }, (_, i) => <i key={i} style={{ height: `${10 + ((index * 19 + i * 37) % 78)}%` }} />)}</div><button className="cover-play" aria-label={`Open ${video.title}`} onClick={onPreview}><Play size={17} fill="currentColor" /></button>{video.isNext && <span className="cover-next"><span /> UP NEXT</span>}<div className="cover-tagline">SIDE A · IN THE MIX</div></div>
    <div className="video-card-body"><div className="video-title-line"><h3>{video.title}</h3><div className="card-menu-wrap"><button className="icon-button card-menu-trigger" aria-label={`More actions for ${video.title}`} aria-expanded={actionsOpen} onClick={() => setActionsOpen(v => !v)}><MoreHorizontal size={19} /></button>{actionsOpen && <><button className="menu-dismiss" aria-label="Close actions" onClick={() => setActionsOpen(false)} /><div className="card-menu"><button onClick={() => { setActionsOpen(false); onEdit(); }}><Pencil size={14} /> Edit details</button><button onClick={() => { setActionsOpen(false); navigator.clipboard.writeText(video.description || video.title).catch(() => undefined); }}><Copy size={14} /> Copy caption</button><button onClick={() => { setActionsOpen(false); onPreview(); }}><Download size={14} /> Download video</button><button onClick={() => { setActionsOpen(false); onDelete(); }}><Trash2 size={14} /> Remove video</button></div></>}</div></div><p className="video-description">{video.description || <span className="muted-italic">No description yet</span>}</p><div className="video-file-meta"><span>{formatBytes(video.sizeBytes)}</span><span>·</span><span>{video.postedCount} {video.postedCount === 1 ? 'share' : 'shares'}</span><span className="meta-spacer" /><span>{readableDate(video.lastPostedAt).split(',')[0]}</span></div>{video.isNext && <div className="video-next-actions"><Button onClick={onPosted} disabled={busy}><Check size={14} /> Mark posted</Button><Button variant="outline" onClick={onSkip} disabled={busy}><SkipForward size={14} /> Skip</Button></div>}</div>
  </article>;
}

// ─── Modal ────────────────────────────────────────────────────────────────────
function Modal({ title, subtitle, children, onClose, wide = false }: { title: string; subtitle: string; children: ReactNode; onClose: () => void; wide?: boolean }) {
  useEffect(() => { const close = (e: KeyboardEvent) => e.key === 'Escape' && onClose(); window.addEventListener('keydown', close); return () => window.removeEventListener('keydown', close); }, [onClose]);
  return <div className="modal-backdrop" role="presentation" onMouseDown={e => e.target === e.currentTarget && onClose()}><section className={`modal-panel ${wide ? 'modal-wide' : ''}`} role="dialog" aria-modal="true" aria-labelledby="modal-title"><div className="modal-heading"><div><span className="section-index">REELKEEPER / YOUR SPACE</span><h2 id="modal-title">{title}</h2><p>{subtitle}</p></div><button className="icon-button modal-close" aria-label="Close dialog" onClick={onClose}><X size={18} /></button></div>{children}</section></div>;
}

// ─── Schedule page ────────────────────────────────────────────────────────────
function SchedulePage() {
  const settings = useGetSettings();
  const update = useUpdateSettings();
  const facebook = useGetFacebookStatus();
  const startConnect = useStartFacebookConnect();
  const selectPage = useSelectFacebookPage();
  const disconnect = useDisconnectFacebook();
  const client = useQueryClient();
  const [enabled, setEnabled] = useState(true);
  const [timezone, setTimezone] = useState(Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC');
  const [changed, setChanged] = useState(false);
  const [notice, setNotice] = useState('');
  const initialized = useRef(false);
  useEffect(() => { if (settings.data && !initialized.current) { initialized.current = true; setEnabled(settings.data.enabled); setTimezone(settings.data.timezone); } }, [settings.data]);
  const schedulePreview = useMemo(() => {
    if (!enabled) return 'Your schedule is paused. Turn it back on whenever you\u2019re ready.';
    const next = settings.data?.nextPostAt ? new Date(settings.data.nextPostAt) : new Date(Date.now() + 3 * 3_600_000);
    return `Next scheduled post: ${new Intl.DateTimeFormat(undefined, { weekday: 'long', hour: 'numeric', minute: '2-digit', timeZone: timezone, timeZoneName: 'short' }).format(next)}.`;
  }, [enabled, settings.data?.nextPostAt, timezone]);
  const save = () => {
    const input: ScheduleSettingsInput = { enabled, intervalHours: 3, timezone };
    update.mutate({ data: input }, { onSuccess: data => { client.setQueryData(getGetSettingsQueryKey(), data); void client.invalidateQueries({ queryKey: getGetSettingsQueryKey() }); setChanged(false); setNotice(enabled ? 'Your 3-hour schedule is on.' : 'Your schedule is paused.'); }, onError: () => setNotice('We couldn\u2019t save your schedule. Try again.') });
  };
  const toggle = (e: ChangeEvent<HTMLInputElement>) => { setEnabled(e.target.checked); setChanged(true); };
  const syncFacebook = (data: FacebookStatus, message: string) => { client.setQueryData(getGetFacebookStatusQueryKey(), data); void client.invalidateQueries({ queryKey: getGetFacebookStatusQueryKey() }); setNotice(message); };
  const connect = () => startConnect.mutate(undefined, { onSuccess: r => { if (r.authorizationUrl) window.location.assign(r.authorizationUrl); else setNotice('Facebook did not return an authorization link. Try again.'); }, onError: () => setNotice('Facebook connection could not start. Check the app setup and try again.') });
  const choosePage = (pageId: string) => selectPage.mutate({ data: { pageId } }, { onSuccess: data => syncFacebook(data, 'Your Facebook Page selection is saved.'), onError: () => setNotice('That Page could not be selected. Try again.') });
  const disconnectPage = () => { if (!window.confirm('Disconnect the Facebook Page from Reelkeeper?')) return; disconnect.mutate(undefined, { onSuccess: data => syncFacebook(data, 'Facebook is disconnected.'), onError: () => setNotice('Facebook could not be disconnected. Try again.') }); };
  const facebookBusy = startConnect.isPending || selectPage.isPending || disconnect.isPending;
  const fbStatus = facebook.data;
  return <AppFrame>
    <PageHeading eyebrow="A RHYTHM THAT\u2019S YOURS" title="Schedule" detail="A steady 3-hour rhythm, with your Page connection in one place." />
    {notice && <Notice message={notice} tone={notice.includes('\u2019') || notice.includes('could not') || notice.includes('did not') ? 'error' : 'success'} onDismiss={() => setNotice('')} />}
    {settings.isLoading ? <div className="schedule-loading"><div /><div /><div /></div> : settings.isError ? <QueryError retry={() => settings.refetch()} /> :
      <div className="schedule-layout animate-rise delay-1">
        <div className="schedule-main-column">
          <section className="schedule-form-card">
            <div className="schedule-form-heading"><span className="section-index">01 / POSTING RHYTHM</span><span className="schedule-icon"><Clock3 size={19} /></span><h2>Keep the cycle moving.</h2><p>Reelkeeper can post the next video to your selected Page every three hours. You can pause any time.</p></div>
            <label className="toggle-row" htmlFor="schedule-enabled"><span><strong>3-hour schedule</strong><small>{enabled ? 'Posting is scheduled while a Page is connected.' : 'Paused until you turn it back on.'}</small></span><span className="switch-wrap"><input id="schedule-enabled" data-testid="input-schedule-enabled" type="checkbox" checked={enabled} onChange={toggle} /><span className="switch-track" /></span></label>
            <div className={`fixed-interval ${!enabled ? 'setting-disabled' : ''}`}><span className="fixed-interval-number">03</span><span><strong>Hours between posts</strong><small>The interval stays simple and consistent.</small></span><span className="fixed-interval-lock">FIXED</span></div>
            <div className={`setting-control timezone-control ${!enabled ? 'setting-disabled' : ''}`}><label htmlFor="timezone">YOUR TIMEZONE</label><div className="hours-control"><select id="timezone" data-testid="select-timezone" disabled={!enabled} value={timezone} onChange={e => { setTimezone(e.target.value); setChanged(true); }}>{timezoneChoices.map(zone => <option key={zone} value={zone}>{zone.replaceAll('_', ' ')}</option>)}</select><ChevronDown size={16} /></div><p>Post times follow this local clock.</p></div>
            <div className="schedule-form-footer"><span>{changed ? 'Unsaved changes' : 'Your settings are up to date'}</span><Button onClick={save} disabled={!changed || update.isPending}>{update.isPending ? <><LoaderCircle size={15} className="spin" /> Saving</> : <><Check size={15} /> Save schedule</>}</Button></div>
          </section>
          <section className="facebook-card" aria-labelledby="facebook-heading">
            <div className="facebook-card-head"><span className="facebook-mark"><Facebook size={18} /></span><div><span className="section-index">02 / FACEBOOK PAGE</span><h2 id="facebook-heading">Your publishing connection</h2></div><span className={`connection-pill ${fbStatus?.connected ? 'connected' : ''}`}><i />{facebook.isLoading ? 'CHECKING' : facebook.isError ? 'STATUS UNKNOWN' : fbStatus?.connected ? 'CONNECTED' : 'NOT CONNECTED'}</span></div>
            {facebook.isLoading ? <div className="fb-skeleton"><i /><i /><i /></div> : facebook.isError ? <div className="fb-error"><CircleAlert size={17} /><span>We couldn&apos;t check your Facebook connection.</span><Button variant="outline" onClick={() => facebook.refetch()}>Try again</Button></div> : <>
              {!fbStatus?.appConfigured && <div className="setup-notice"><CircleAlert size={17} /><p><strong>Facebook connection setup is not complete.</strong> The app needs its Facebook OAuth credentials and a matching callback URL before you can connect. Current callback URL: <code>{fbStatus?.callbackUrl || 'Not provided'}</code></p></div>}
              {fbStatus?.connected
                ? <div className="connected-content">
                    <div className="fb-connected-copy"><ShieldCheck size={18} /><span><strong>Facebook is connected.</strong><small>Choose which Page Reelkeeper should publish to.</small></span></div>
                    {fbStatus.pages.length ? <div className="page-choice-list" role="radiogroup" aria-label="Choose a Facebook Page">{fbStatus.pages.map(page => <label key={page.pageId} className={`page-choice ${page.selected ? 'page-choice-selected' : ''}`}><span className="page-radio"><input type="radio" name="facebook-page" value={page.pageId} checked={page.selected} disabled={facebookBusy} onChange={() => choosePage(page.pageId)} /><i /></span><span className="page-choice-copy"><strong>{page.pageName}</strong><small>Page · {page.pageId}</small></span>{page.selected && <span className="selected-label"><Check size={13} /> SELECTED</span>}</label>)}</div> : <p className="no-pages">No Pages were returned for this connection. Check the Facebook account&apos;s Page access and reconnect if needed.</p>}
                    <div className="facebook-actions"><Button variant="quiet" onClick={disconnectPage} disabled={facebookBusy}>{disconnect.isPending ? <LoaderCircle size={15} className="spin" /> : <X size={15} />} Disconnect Page</Button></div>
                  </div>
                : <div className="facebook-connect-row"><div><strong>Connect the Page you manage</strong><p>Reelkeeper will use the authorization provided by Facebook. You can disconnect at any time.</p></div><Button onClick={connect} disabled={!fbStatus?.appConfigured || facebookBusy}>{startConnect.isPending ? <><LoaderCircle size={15} className="spin" /> Connecting</> : <><Facebook size={15} /> Connect Facebook</>}</Button></div>}
              <div className={`insights-status ${fbStatus?.viewInsightsAvailable ? 'insights-available' : ''}`}><span className="insights-indicator" /><div><strong>{fbStatus?.viewInsightsAvailable ? 'View insights available' : 'View insights not available'}</strong><p>{fbStatus?.viewInsightsAvailable ? (fbStatus.viewInsightsMessage || 'Page view counts can be used when available.') : (fbStatus?.viewInsightsMessage || 'Optional access. Posting can continue without view insights.')}</p></div></div>
              {fbStatus?.lastError && <p className="facebook-last-error" role="status"><CircleAlert size={15} />{fbStatus.lastError}</p>}
            </>}
          </section>
        </div>
        <aside className="schedule-aside">
          <div className="schedule-preview"><span className="section-index">03 / NEXT POST</span><div className="preview-clock"><span className="clock-hand hand-hour" /><span className="clock-hand hand-minute" /><span className="clock-center" /><span className="clock-tick tick-12" /><span className="clock-tick tick-3" /><span className="clock-tick tick-6" /><span className="clock-tick tick-9" /></div><h3>{enabled ? 'Every 3 hours' : 'Whenever you\u2019re ready'}</h3><p>{schedulePreview}</p><div className={`schedule-status ${enabled ? 'status-on' : 'status-off'}`}><span />{enabled ? 'SCHEDULE ON' : 'SCHEDULE PAUSED'}</div></div>
          <div className="schedule-honesty"><span><ShieldCheck size={17} /></span><div><strong>Clear about access.</strong><p>Facebook authorization is required to publish. View insights are optional; Reelkeeper shows when that access is unavailable.</p></div></div>
          <div className="last-activity"><span className="section-index">LAST POSTED</span><strong>{readableDate(settings.data?.lastPostedAt)}</strong>{settings.data?.lastPostVideoTitle && <small>{settings.data.lastPostVideoTitle}</small>}</div>
        </aside>
      </div>}
  </AppFrame>;
}

// ─── Root app with Supabase auth state ────────────────────────────────────────
function AppWithAuth() {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Seed the initial session on mount
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setUser(data.session?.user ?? null);
      setLoading(false);
    });
    // Listen for sign-in / sign-out events
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession);
      setUser(newSession?.user ?? null);
      // Clear React Query cache on auth change (same as ClerkCacheInvalidator did)
      queryClient.clear();
    });
    return () => subscription.unsubscribe();
  }, []);

  if (loading) {
    return <div className="app-loading grain"><div className="loading-inner"><Film size={28} strokeWidth={1.5} /><span>Loading your space…</span></div></div>;
  }

  return (
    <AuthCtx.Provider value={{ user, session }}>
      <WouterRouter base={basePath}>
        <Switch>
          <Route path="/" component={HomeRoute} />
          <Route path="/sign-in" component={() => <AuthPage mode="sign_in" />} />
          <Route path="/sign-up" component={() => <AuthPage mode="sign_up" />} />
          <Route path="/today" component={TodayRoute} />
          <Route path="/library" component={LibraryRoute} />
          <Route path="/schedule" component={ScheduleRoute} />
          <Route component={() => <div className="not-found"><Logo /><h1>This page wandered off.</h1><Link href="/" className="text-link">Back to your space <ArrowRight size={15} /></Link></div>} />
        </Switch>
      </WouterRouter>
    </AuthCtx.Provider>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AppWithAuth />
    </QueryClientProvider>
  );
}

export default App;
