import { useEffect, useMemo, useRef, useState, type ChangeEvent, type FormEvent, type ReactNode } from 'react';
import { ClerkProvider, SignIn, SignUp, Show, useClerk, useUser } from '@clerk/react';
import { publishableKeyFromHost } from '@clerk/react/internal';
import { shadcn } from '@clerk/themes';
import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import { Link, Redirect, Route, Router as WouterRouter, Switch, useLocation } from 'wouter';
import {
  ArrowRight, Bell, Check, CheckCircle2, ChevronDown, Clock3,
  CloudUpload, Copy, Download, Film, FolderOpen, Headphones, LoaderCircle, LogOut,
  Menu, MoreHorizontal, Pencil, Play, Plus, RotateCw, SkipForward, Sparkles,
  Trash2, Upload, X, Facebook, ShieldCheck, CircleAlert,
} from 'lucide-react';
import {
  getGetFacebookStatusQueryKey, getGetSettingsQueryKey, getGetVideoFileUrlQueryKey, getListVideosQueryKey, useCreateVideo, useDeleteVideo,
  useDisconnectFacebook, useGetFacebookStatus, useSelectFacebookPage, useStartFacebookConnect,
  useGetSettings, useGetVideoFileUrl, useListVideos, useMarkVideoPosted,
  useRequestUploadUrl, useSkipVideo, useUpdateSettings, useUpdateVideo,
} from '@workspace/api-client-react';
import type { FacebookStatus, ScheduleSettingsInput, Video, VideoInput } from '@workspace/api-client-react';
import './index.css';

const queryClient = new QueryClient();
const basePath = import.meta.env.BASE_URL.replace(/\/$/, '');
const clerkPubKey = publishableKeyFromHost(window.location.hostname, import.meta.env.VITE_CLERK_PUBLISHABLE_KEY);
const clerkProxyUrl = import.meta.env.VITE_CLERK_PROXY_URL;
function stripBase(path: string) { return basePath && path.startsWith(basePath) ? path.slice(basePath.length) || '/' : path; }
if (!clerkPubKey) throw new Error('Missing VITE_CLERK_PUBLISHABLE_KEY');

const appearance = {
  theme: shadcn,
  cssLayerName: 'clerk',
  options: { logoPlacement: 'inside' as const, logoLinkUrl: basePath || '/', logoImageUrl: `${window.location.origin}${basePath}/logo.svg` },
  variables: {
    colorPrimary: '#315d53', colorForeground: '#263d38', colorMutedForeground: '#71817c',
    colorDanger: '#a0443f', colorBackground: '#fbf8f0', colorInput: '#f8f4eb',
    colorInputForeground: '#263d38', colorNeutral: '#d9d3c6', fontFamily: 'DM Sans',
    borderRadius: '0.8rem',
  },
  elements: {
    rootBox: 'w-full flex justify-center',
    cardBox: 'bg-[#fbf8f0] rounded-2xl w-[440px] max-w-full overflow-hidden',
    card: '!shadow-none !border-0 !bg-transparent !rounded-none',
    footer: '!shadow-none !border-0 !bg-transparent !rounded-none',
    headerTitle: '!text-[#263d38]', headerSubtitle: '!text-[#71817c]',
    socialButtonsBlockButtonText: '!text-[#263d38]', formFieldLabel: '!text-[#263d38]',
    footerActionLink: 'text-[#315d53]', footerActionText: 'text-[#71817c]',
    dividerText: 'text-[#71817c]', identityPreviewEditButton: 'text-[#315d53]',
    formFieldSuccessText: 'text-[#315d53]', alertText: 'text-[#263d38]',
    logoBox: 'rounded-xl', logoImage: 'rounded-xl', socialButtonsBlockButton: 'border-[#d9d3c6]',
    formButtonPrimary: '!text-white bg-[#315d53] hover:bg-[#24483f]', formFieldInput: '!text-[#263d38] bg-[#f8f4eb] border-[#d9d3c6]',
    footerAction: 'text-[#71817c]', dividerLine: 'bg-[#d9d3c6]', alert: 'bg-[#f5eee0]',
    otpCodeFieldInput: 'bg-[#f8f4eb]', formFieldRow: 'text-[#263d38]', main: 'text-[#263d38]',
  },
};

const formatBytes = (bytes: number) => bytes >= 1_000_000_000 ? `${(bytes / 1_000_000_000).toFixed(1)} GB` : `${(bytes / 1_000_000).toFixed(0)} MB`;
const readableDate = (value?: string | null) => value ? new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value)) : 'Not yet';
const timezoneChoices = (() => { try { return Intl.supportedValuesOf('timeZone'); } catch { return ['America/Los_Angeles', 'America/New_York', 'Europe/London', 'Asia/Tokyo', 'UTC']; } })();

function Logo({ inverse = false }: { inverse?: boolean }) {
  return <Link href="/" className={`brand ${inverse ? 'brand-light' : ''}`} aria-label="Reelkeeper home"><span className="brand-mark"><Film size={17} strokeWidth={1.7} /></span><span>reelkeeper<span className="brand-period">.</span></span></Link>;
}

function Button({ children, onClick, variant = 'primary', disabled, type = 'button', className = '', ...props }: {
  children: ReactNode; onClick?: () => void; variant?: 'primary' | 'quiet' | 'outline' | 'danger'; disabled?: boolean; type?: 'button' | 'submit'; className?: string; [key: string]: any;
}) {
  return <button type={type} onClick={onClick} disabled={disabled} className={`button button-${variant} ${className}`} {...props}>{children}</button>;
}

function AppFrame({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  const { user } = useUser();
  const { signOut } = useClerk();
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
  const nextVideo = list.data?.videos.find((video) => video.isNext);
  useEffect(() => {
    if (!reminderDue || !nextPostAt || !user?.id || !("Notification" in window)) return;
    if (Notification.permission !== "granted") return;
    const key = `reelkeeper-reminder:${user.id}:${nextPostAt}`;
    if (localStorage.getItem(key) === "sent") return;
    new Notification("Your next lyric video is ready", {
      body: nextVideo?.title ? `Time to share “${nextVideo.title}” when you’re ready.` : "Your posting reminder is due.",
      icon: `${basePath}/logo.svg`,
    });
    localStorage.setItem(key, "sent");
  }, [reminderDue, nextPostAt, user?.id, nextVideo?.title]);
  const nav = [{ href: '/', label: 'Today', icon: Sparkles }, { href: '/library', label: 'Your library', icon: FolderOpen }, { href: '/schedule', label: 'Reminder rhythm', icon: Clock3 }];
  return <div className="app-frame grain">
    <aside className={`sidebar ${mobileOpen ? 'sidebar-open' : ''}`}>
      <div className="sidebar-top"><Logo inverse /><button className="icon-button sidebar-close" aria-label="Close menu" onClick={() => setMobileOpen(false)}><X size={18} /></button></div>
      <div className="sidebar-caption">YOUR SPACE</div>
      <nav className="side-nav" aria-label="Main navigation">{nav.map(({ href, label, icon: Icon }) => <Link key={href} href={href} className={`side-link ${location === href ? 'side-link-active' : ''}`} onClick={() => setMobileOpen(false)}><Icon size={17} strokeWidth={1.8} /><span>{label}</span>{href === '/library' && <span className="side-arrow">↗</span>}</Link>)}</nav>
      <div className="sidebar-spacer" />
      <div className="sidebar-note"><span className="note-mark">“</span><p>Make room for the work that wants to be seen.</p><span className="note-byline">A LITTLE REMINDER</span></div>
      <div className="profile-row"><span className="profile-avatar">{user?.firstName?.[0] || user?.username?.[0] || 'R'}</span><span className="profile-copy"><strong>{user?.firstName || user?.username || 'Your studio'}</strong><small>Private creator space</small></span><button className="icon-button logout-button" aria-label="Sign out" title="Sign out" onClick={() => signOut({ redirectUrl: basePath || '/' })}><LogOut size={16} /></button></div>
    </aside>
    {mobileOpen && <button className="mobile-scrim" aria-label="Close navigation" onClick={() => setMobileOpen(false)} />}
    <main className="main-area">
      <header className="mobile-header"><button className="icon-button" aria-label="Open menu" onClick={() => setMobileOpen(true)}><Menu size={20} /></button><Logo /><div className="mobile-header-spacer" /></header>
      <div className="page-content">
        {reminderDue && <div className="due-banner" role="status" data-testid="status-reminder-due"><Bell size={17} /><span><strong>Your reminder is due.</strong> {nextVideo ? `“${nextVideo.title}” is next in your rotation.` : "Your next video is ready."} Posting stays manual.</span><Link href="/today" className="text-link">Open today <ArrowRight size={14} /></Link></div>}
        {children}
      </div>
    </main>
  </div>;
}

function Landing() {
  return <div className="landing grain">
    <header className="landing-nav"><Logo /><Link href="/sign-in" className="landing-signin">Sign in <ArrowRight size={15} /></Link></header>
    <section className="hero-section">
      <div className="hero-copy animate-rise"><div className="eyebrow"><span className="eyebrow-dot" /> A QUIETER WAY TO KEEP THE CYCLE MOVING</div><h1>Your words.<br /><em>In rotation.</em></h1><p className="hero-lede">A private little home for your lyric videos — with a dependable posting rhythm when you want one.</p><div className="hero-actions"><Link href="/sign-up" className="button button-primary">Make your space <ArrowRight size={16} /></Link><span className="private-note"><span className="tiny-lock">PRIVATE</span> Just for you. Always.</span></div></div>
      <div className="hero-art animate-rise delay-1" aria-label="Abstract artwork of a film frame and sunlit lyric lines"><div className="art-orbit orbit-one" /><div className="art-orbit orbit-two" /><div className="art-sun" /><div className="art-frame"><div className="frame-perf perf-top" /><div className="frame-center"><span className="frame-label">SIDE A — TRACK 04</span><div className="lyric-lines"><span>the light keeps</span><em>finding its way</em><span>back to me</span></div><div className="sound-wave"><i /><i /><i /><i /><i /><i /><i /><i /><i /><i /><i /><i /><i /><i /><i /><i /><i /><i /><i /><i /><i /></div><span className="frame-time">00:18 <b>/</b> 00:42</span></div><div className="frame-perf perf-bottom" /></div><div className="floating-note">a loop worth keeping <span>↗</span></div><div className="art-index">01 / YOUR NEXT CHAPTER</div></div>
      <div className="hero-footnote"><span>01</span><span>BUILT FOR ONE CREATOR, ONE GOOD LOOP AT A TIME</span><span>SCROLL TO SEE THE RHYTHM ↓</span></div>
    </section>
    <section className="manifesto-section"><div className="section-index">THE IDEA / 01</div><div className="manifesto-copy"><p className="manifesto-kicker">Less juggling. More making.</p><h2>Keep the videos close.<br /><em>Keep the ritual simple.</em></h2><p className="manifesto-desc">Reelkeeper remembers what’s in the mix, what’s next, and when you meant to come back. The posting stays yours — always a human, always your call.</p></div><div className="manifesto-stamp"><span>YOUR<br />OWN<br /><em>PACE</em></span><div className="stamp-ring">PRIVATE • PERSONAL • YOURS •</div></div></section>
     <section className="flow-section"><div className="flow-heading"><div className="section-index">A SMALL, LOVELY LOOP / 02</div><h2>From finished file<br />to <em>ready when you are.</em></h2></div><div className="flow-rail"><div className="flow-step"><span className="flow-number">01</span><div className="flow-icon"><CloudUpload size={20} /></div><h3>Drop it in</h3><p>Keep your big, beautiful video files in one private library. Add the title and caption while the moment is fresh.</p><span className="flow-caption">MULTIPLE FILES, UP TO 2 GB EACH</span></div><div className="flow-connector"><span>→</span></div><div className="flow-step"><span className="flow-number">02</span><div className="flow-icon"><RotateCw size={20} /></div><h3>Let the queue breathe</h3><p>Your videos move through a simple first-in, first-out rotation. The next one is never a guessing game.</p><span className="flow-caption">A QUEUE THAT REMEMBERS</span></div><div className="flow-connector"><span>→</span></div><div className="flow-step"><span className="flow-number">03</span><div className="flow-icon"><Headphones size={20} /></div><h3>Set the rhythm</h3><p>Connect a Facebook Page to schedule the next video every three hours. Pause it whenever you need room.</p><span className="flow-caption">A SIMPLE, OPTIONAL SCHEDULE</span></div></div></section>
     <section className="honesty-section"><div className="honesty-asterisk"><ShieldCheck size={28} /></div><div><span className="section-index">A NOTE ON HOW THIS WORKS</span><h2>A steady cycle.<br /><em>Clear, optional access.</em></h2><p>Connect a Facebook Page to use the scheduled three-hour rhythm. You can pause it whenever you like. View insights are optional and won’t block publishing.</p></div><div className="manual-card"><span className="manual-check"><Check size={18} /></span><strong>Your Page, your choice.</strong><small>Choose a connected Page or disconnect it at any time.</small><div className="manual-status"><span /> ONE CREATOR · ONE QUEUE</div></div></section>
     <section className="closing-section"><div className="closing-decoration">R<br />K</div><span className="section-index">MAKE THE NEXT ONE COUNT / 03</span><h2>Make a little<br /><em>room for your songs.</em></h2><Link href="/sign-up" className="button button-primary">Start your private queue <ArrowRight size={16} /></Link><p>One creator. One private space. A rhythm you can pause.</p></section>
    <footer className="landing-footer"><Logo /><span>A private queue for the things you make.</span><span>© REELKEEPER — MADE FOR THE MOMENT BEFORE SHARE</span></footer>
  </div>;
}

function HomeRoute() { return <><Show when="signed-in"><Redirect to="/today" /></Show><Show when="signed-out"><Landing /></Show></>; }
function TodayRoute() { return <><Show when="signed-in"><Dashboard /></Show><Show when="signed-out"><Redirect to="/" /></Show></>; }
function LibraryRoute() { return <><Show when="signed-in"><LibraryPage /></Show><Show when="signed-out"><Redirect to="/" /></Show></>; }
function ScheduleRoute() { return <><Show when="signed-in"><SchedulePage /></Show><Show when="signed-out"><Redirect to="/" /></Show></>; }

function ClerkCacheInvalidator() {
  const { addListener } = useClerk();
  const client = useQueryClient();
  const prev = useRef<string | null | undefined>(undefined);
  useEffect(() => addListener(({ user }) => {
    const id = user?.id ?? null;
    if (prev.current !== undefined && prev.current !== id) client.clear();
    prev.current = id;
  }), [addListener, client]);
  return null;
}

function ClerkProviderWithRoutes() {
  const [, setLocation] = useLocation();
  return <ClerkProvider publishableKey={clerkPubKey} proxyUrl={clerkProxyUrl} appearance={appearance} signInUrl={`${basePath}/sign-in`} signUpUrl={`${basePath}/sign-up`}
    localization={{ signIn: { start: { title: 'Welcome back', subtitle: 'Your videos are right where you left them.' } }, signUp: { start: { title: 'Make it your space', subtitle: 'A private queue for the work you make.' } } }}
    routerPush={(to) => setLocation(stripBase(to))} routerReplace={(to) => setLocation(stripBase(to), { replace: true })}>
    <QueryClientProvider client={queryClient}><ClerkCacheInvalidator /><Switch>
      <Route path="/" component={HomeRoute} />
      <Route path="/sign-in/*?" component={() => <div className="auth-page grain"><div className="auth-aside"><Logo inverse /><div><span className="section-index">YOUR WORK, IN ITS OWN LITTLE HOME</span><h1>Come back<br /><em>to your songs.</em></h1><p>A calm place to keep the next lyric video close.</p></div><span className="auth-quote">“Keep making things that sound like you.”</span></div><div className="auth-content"><SignIn routing="path" path={`${basePath}/sign-in`} signUpUrl={`${basePath}/sign-up`} /></div></div>} />
      <Route path="/sign-up/*?" component={() => <div className="auth-page grain"><div className="auth-aside"><Logo inverse /><div><span className="section-index">A SPACE THAT MOVES AT YOUR SPEED</span><h1>Start with<br /><em>what you made.</em></h1><p>Let a little rhythm take care of the remembering.</p></div><span className="auth-quote">“A good loop deserves another listen.”</span></div><div className="auth-content"><SignUp routing="path" path={`${basePath}/sign-up`} signInUrl={`${basePath}/sign-in`} /><p className="owner-claim-note">This is a one-creator space. The first account to sign in becomes its owner.</p></div></div>} />
      <Route path="/today" component={TodayRoute} /><Route path="/library" component={LibraryRoute} /><Route path="/schedule" component={ScheduleRoute} />
      <Route component={() => <div className="not-found"><Logo /><h1>This page wandered off.</h1><Link href="/" className="text-link">Back to your space <ArrowRight size={15} /></Link></div>} />
    </Switch></QueryClientProvider>
  </ClerkProvider>;
}

function Router() { return <WouterRouter base={basePath}><ClerkProviderWithRoutes /></WouterRouter>; }
function App() { return <Router />; }

function PageHeading({ eyebrow, title, detail, action }: { eyebrow: string; title: string; detail: string; action?: ReactNode }) {
  return <div className="page-heading animate-rise"><div><div className="eyebrow"><span className="eyebrow-dot" />{eyebrow}</div><h1>{title}</h1><p>{detail}</p></div>{action && <div className="heading-action">{action}</div>}</div>;
}
function QueryError({ retry }: { retry: () => void }) { return <div className="error-panel"><span className="error-icon"><RotateCw size={19} /></span><strong>We couldn't open this page just now.</strong><span>Give it another try. Your library is still safe.</span><Button variant="outline" onClick={retry}>Try again</Button></div>; }
function SkeletonRows() { return <div className="skeleton-list" aria-label="Loading your videos">{[1, 2, 3].map(n => <div key={n} className="skeleton-row"><span className="skeleton-thumb" /><span className="skeleton-lines"><i /><i /></span><span className="skeleton-pill" /></div>)}</div>; }
function Notice({ message, tone = 'success', onDismiss }: { message: string; tone?: 'success' | 'error'; onDismiss: () => void }) { return <div className={`notice notice-${tone}`} role="status"><span>{tone === 'success' ? <CheckCircle2 size={17} /> : <X size={17} />}</span>{message}<button className="icon-button" aria-label="Dismiss notification" onClick={onDismiss}><X size={15} /></button></div>; }

function Dashboard() {
  const list = useListVideos();
  const settings = useGetSettings();
  const mark = useMarkVideoPosted();
  const skip = useSkipVideo();
  const { user } = useUser();
  const client = useQueryClient();
  const [notice, setNotice] = useState('');
  const videos = list.data?.videos || [];
  const nextVideo = videos.find(video => video.isNext) || videos[0];
  const syncList = (data?: { videos: Video[] }) => data && client.setQueryData(getListVideosQueryKey(), data);
  const act = (kind: 'posted' | 'skip') => {
    if (!nextVideo) return;
    const action = kind === 'posted' ? mark : skip;
    action.mutate({ id: nextVideo.id }, { onSuccess: data => { syncList(data); setNotice(kind === 'posted' ? 'Marked as posted. The queue has moved on.' : 'Skipped for this pass. The queue has moved on.'); }, onError: () => setNotice('That didn’t go through. Please try once more.') });
  };
  const first = user?.firstName?.trim() || 'there';
  const nextAt = settings.data?.nextPostAt;
  const hoursLeft = nextAt ? Math.max(0, Math.ceil((new Date(nextAt).getTime() - Date.now()) / 3_600_000)) : null;
  return <AppFrame><div className="home-topline"><span>YOUR PRIVATE CREATOR SPACE</span><span className="date-mark">{new Intl.DateTimeFormat(undefined, { weekday: 'long', month: 'long', day: 'numeric' }).format(new Date())}</span></div>
    <div className="welcome-block animate-rise"><div><p className="welcome-label">A good day to make something</p><h1>Hello, {first}<span className="accent-dot">.</span></h1><p className="welcome-subtitle">Your videos are here. The next step is yours.</p></div><div className="welcome-scribble" aria-hidden="true">RK</div></div>
    {notice && <Notice message={notice} tone={notice.includes('didn’t') ? 'error' : 'success'} onDismiss={() => setNotice('')} />}
    <section className="next-section animate-rise delay-1"><div className="section-topline"><div><span className="section-index">01 / UP NEXT</span><h2>Ready when you are</h2></div><Link href="/library" className="text-link">See the whole library <ArrowRight size={15} /></Link></div>
      {list.isLoading ? <div className="next-skeleton"><span className="next-skeleton-image" /><span className="skeleton-lines"><i /><i /></span></div> : list.isError ? <QueryError retry={() => list.refetch()} /> : nextVideo ? <div className="feature-card"><div className="feature-art"><div className="film-rail" /><div className="feature-art-content"><span className="feature-tag"><span /> NEXT IN ROTATION</span><span className="feature-no">{String(nextVideo.postedCount + 1).padStart(2, '0')}</span><div className="feature-wave">{Array.from({ length: 39 }, (_, i) => <i key={i} style={{ height: `${12 + ((i * 31 + 17) % 57)}%` }} />)}</div><span className="feature-reel">A REELKEEPER SELECTION</span></div></div>
        <div className="feature-details"><div className="feature-description"><span className="detail-label">UP NEXT IN YOUR ROTATION</span><h3>{nextVideo.title}</h3><p>{nextVideo.description || 'No caption yet. Add a little context in your library whenever you like.'}</p><div className="feature-meta"><span><RotateCw size={14} /> Posted {nextVideo.postedCount} {nextVideo.postedCount === 1 ? 'time' : 'times'}</span><span><Clock3 size={14} /> {hoursLeft === null ? 'Reminder not set' : hoursLeft === 0 ? 'Reminder is due' : `Reminder in about ${hoursLeft}h`}</span></div></div><div className="feature-actions"><Button onClick={() => act('posted')} disabled={mark.isPending || skip.isPending} className="posted-button">{mark.isPending ? <LoaderCircle size={16} className="spin" /> : <Check size={16} />} Mark as posted</Button><Button variant="outline" onClick={() => act('skip')} disabled={mark.isPending || skip.isPending}><SkipForward size={15} /> Skip this one</Button><p>Manual posting only. Nothing is published for you.</p></div></div></div> : <div className="empty-feature"><div className="empty-film"><Film size={24} /></div><span className="section-index">A FRESH FRAME IS WAITING</span><h3>Your rotation starts with one video.</h3><p>Add a lyric video and it’ll be right here when you’re ready to share.</p><Link href="/library" className="button button-primary"><Plus size={16} /> Add your first video</Link></div>}
    </section>
    <section className="dashboard-bottom animate-rise delay-2"><div className="rhythm-card"><div className="rhythm-head"><div><span className="section-index">02 / YOUR RHYTHM</span><h3>A gentle reminder</h3></div><Clock3 size={18} /></div>{settings.isLoading ? <div className="rhythm-skeleton"><i /><i /></div> : settings.isError ? <p className="rhythm-caption">We couldn't check your reminder settings.</p> : <><div className="rhythm-value">{settings.data?.enabled ? `${settings.data.intervalHours}h` : 'Paused'}<span>{settings.data?.enabled ? 'between reminders' : 'reminders are paused'}</span></div><div className={`schedule-status ${settings.data?.enabled ? 'status-on' : 'status-off'}`}><span />{settings.data?.enabled ? 'ON YOUR TIME' : 'PAUSED'}</div><p className="rhythm-caption">{settings.data?.nextPostAt ? `Next reminder ${readableDate(settings.data.nextPostAt)}` : 'Choose a rhythm that feels right for you.'}</p></>}<Link href="/schedule" className="text-link">Adjust your rhythm <ArrowRight size={14} /></Link></div>
      <div className="library-glance"><div className="glance-heading"><div><span className="section-index">03 / RECENTLY ADDED</span><h3>From your library</h3></div><Link href="/library" className="text-link">View all <ArrowRight size={14} /></Link></div>{list.isLoading ? <SkeletonRows /> : list.isError ? <p className="subtle">Your recent videos aren’t available right now.</p> : videos.length ? <div className="recent-list">{videos.slice(0, 3).map((video, i) => <div className="recent-item" key={video.id}><span className={`recent-index recent-color-${i % 3}`}>{String(i + 1).padStart(2, '0')}</span><span className="recent-copy"><strong>{video.title}</strong><small>{video.originalFilename}</small></span>{video.isNext && <span className="mini-next">NEXT</span>}</div>)}</div> : <div className="recent-empty">Your new additions will find a home here.</div>}</div></section>
    <div className="manual-footnote"><span className="manual-dot" /> Everything here is a reminder, not an autopilot. You choose what gets posted, and when.</div>
  </AppFrame>;
}

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
  const visible = filter === 'next' ? videos.filter(video => video.isNext) : videos;
  const invalidate = () => client.invalidateQueries({ queryKey: getListVideosQueryKey() });
  const addFiles = (files: FileList | null) => {
    if (!files) return;
    const next: DraftVideo[] = Array.from(files).filter(file => file.type.startsWith('video/')).map(file => ({ file, title: file.name.replace(/\.[^.]+$/, '').slice(0, 120), description: '', progress: 0, status: 'queued' }));
    setDrafts(current => [...current, ...next]);
    setModal('upload');
  };
  const setDraft = (index: number, key: 'title' | 'description', value: string) => setDrafts(old => old.map((draft, i) => i === index ? { ...draft, [key]: value } : draft));
  const uploadAll = async () => {
    for (let index = 0; index < drafts.length; index++) {
      const draft = drafts[index];
      if (draft.status === 'done') continue;
      if (!draft.title.trim()) { setDrafts(old => old.map((d, i) => i === index ? { ...d, error: 'Add a title before uploading.' } : d)); return; }
      try {
        setDrafts(old => old.map((d, i) => i === index ? { ...d, status: 'uploading', progress: 5, error: undefined } : d));
        const contentType = draft.file.type || 'video/mp4';
        const { uploadURL, objectPath } = await requestUpload.mutateAsync({ data: { name: draft.file.name, size: draft.file.size, contentType } });
        const xhr = await new Promise<void>((resolve, reject) => {
          const request = new XMLHttpRequest();
          request.open('PUT', uploadURL);
          request.setRequestHeader('Content-Type', contentType);
          request.upload.onprogress = event => { if (event.lengthComputable) setDrafts(old => old.map((d, i) => i === index ? { ...d, progress: Math.round(event.loaded / event.total * 88) } : d)); };
          request.onload = () => request.status >= 200 && request.status < 300 ? resolve() : reject(new Error(`Upload failed (${request.status}).`));
          request.onerror = () => reject(new Error('The upload connection was interrupted.'));
          request.send(draft.file);
        });
        void xhr;
        const input: VideoInput = { title: draft.title.trim(), description: draft.description, originalFilename: draft.file.name, objectPath, mimeType: contentType, sizeBytes: draft.file.size };
        await createVideo.mutateAsync({ data: input });
        setDrafts(old => old.map((d, i) => i === index ? { ...d, status: 'done', progress: 100 } : d));
        await invalidate();
      } catch (error) {
        const msg = error instanceof Error ? error.message : 'This video could not be uploaded.';
        setDrafts(old => old.map((d, i) => i === index ? { ...d, status: 'error', error: msg } : d));
        return;
      }
    }
    setNotice('Your videos are safely in the library.');
  };
  const closeUpload = () => { setModal(null); setDrafts([]); };
  const beginEdit = (video: Video) => { setEditVideo(video); setTitle(video.title); setDescription(video.description); setModal('edit'); };
  const submitEdit = (event: FormEvent) => { event.preventDefault(); if (!editVideo) return; update.mutate({ id: editVideo.id, data: { title: title.trim(), description } }, { onSuccess: () => { setModal(null); setNotice('Video details saved.'); invalidate(); }, onError: () => setNotice('We couldn’t save those details. Try again.') }); };
  const confirmDelete = () => { if (!deleteVideo) return; remove.mutate({ id: deleteVideo.id }, { onSuccess: () => { setModal(null); setNotice('Video removed from your library.'); invalidate(); }, onError: () => setNotice('We couldn’t remove this video. Try again.') }); };
  const playVideo = (video: Video) => { setPreviewId(video.id); setModal('preview'); };
  return <AppFrame><PageHeading eyebrow="YOUR PRIVATE ARCHIVE" title="Your library" detail="Every lyric video in its own little place." action={<label className="button button-primary upload-trigger"><Plus size={16} /> Add videos<input data-testid="input-upload-videos" type="file" accept="video/*" multiple hidden onChange={(e: ChangeEvent<HTMLInputElement>) => { addFiles(e.target.files); e.target.value = ''; }} /></label>} />
    {notice && <Notice message={notice} tone={notice.includes('couldn’t') ? 'error' : 'success'} onDismiss={() => setNotice('')} />}
    <div className="library-toolbar"><div className="library-stats"><span className="library-count">{videos.length.toString().padStart(2, '0')}</span><span>VIDEO{videos.length === 1 ? '' : 'S'} IN THE ROTATION</span></div><div className="filter-tabs" role="group" aria-label="Filter videos"><button className={filter === 'all' ? 'filter-active' : ''} onClick={() => setFilter('all')}>Everything <span>{videos.length}</span></button><button className={filter === 'next' ? 'filter-active' : ''} onClick={() => setFilter('next')}>Up next <span>{videos.filter(v => v.isNext).length}</span></button></div></div>
    {list.isLoading ? <SkeletonRows /> : list.isError ? <QueryError retry={() => list.refetch()} /> : visible.length ? <div className="library-grid">{visible.map((video, index) => <VideoCard key={video.id} video={video} index={index} onEdit={() => beginEdit(video)} onDelete={() => { setDeleteVideo(video); setModal('delete'); }} onPreview={() => playVideo(video)} onPosted={() => mark.mutate({ id: video.id }, { onSuccess: data => { client.setQueryData(getListVideosQueryKey(), data); setNotice('Marked as posted. Queue advanced.'); }, onError: () => setNotice('Unable to update posting status.') })} onSkip={() => skip.mutate({ id: video.id }, { onSuccess: data => { client.setQueryData(getListVideosQueryKey(), data); setNotice('Skipped for this pass.') }, onError: () => setNotice('Unable to skip this video.') })} busy={mark.isPending || skip.isPending} />)}</div> : filter === 'all' ? <div className="library-empty"><div className="empty-film"><Film size={23} /></div><span className="section-index">A LITTLE SPACE FOR WHAT YOU MAKE</span><h2>Your library is waiting.</h2><p>Add a lyric video to start your rotation. Big files are welcome — uploads go straight to private storage.</p><label className="button button-primary upload-trigger"><CloudUpload size={16} /> Choose video files<input type="file" accept="video/*" multiple hidden onChange={(e: ChangeEvent<HTMLInputElement>) => { addFiles(e.target.files); e.target.value = ''; }} /></label><small>Video files up to 2 GB each</small></div> : <div className="library-empty compact-empty"><h2>Nothing is up next just yet.</h2><p>Your rotation will bring the next video here.</p><Button variant="outline" onClick={() => setFilter('all')}>Show everything</Button></div>}
    <div className="upload-note"><CloudUpload size={16} /><span>Large files are uploaded directly to private storage. Reelkeeper keeps the queue and your captions close.</span><span className="upload-limit">UP TO 2 GB / VIDEO</span></div>
    {modal === 'upload' && <Modal title="Add to your rotation" subtitle="A title and description for each video keeps posting day simple." onClose={closeUpload} wide><div className="draft-list">{drafts.map((draft, i) => <div className="draft-item" key={`${draft.file.name}-${i}`}><div className="draft-file"><span className="draft-icon"><Film size={17} /></span><span><strong>{draft.file.name}</strong><small>{formatBytes(draft.file.size)} · {draft.status === 'done' ? 'Added to library' : draft.status === 'uploading' ? `Uploading · ${draft.progress}%` : draft.status === 'error' ? 'Upload needs attention' : 'Ready to upload'}</small></span>{draft.status !== 'uploading' && draft.status !== 'done' && <button aria-label={`Remove ${draft.file.name}`} className="icon-button" onClick={() => setDrafts(old => old.filter((_, index) => index !== i))}><X size={16} /></button>}{draft.status === 'done' && <CheckCircle2 className="done-check" size={18} />}</div><div className="draft-fields"><label>REEL TITLE<input maxLength={120} value={draft.title} onChange={e => setDraft(i, 'title', e.target.value)} placeholder="Give this video a name" /></label><label>DESCRIPTION <span className="optional">(OPTIONAL)</span><textarea maxLength={5000} rows={2} value={draft.description} onChange={e => setDraft(i, 'description', e.target.value)} placeholder="A caption to keep with the video" /></label></div>{draft.status === 'uploading' && <div className="upload-progress"><span style={{ width: `${draft.progress}%` }} /></div>}{draft.error && <p className="field-error">{draft.error}</p>}</div>)}</div><label className="add-more"><Plus size={15} /> Add more files<input type="file" accept="video/*" multiple hidden onChange={(e: ChangeEvent<HTMLInputElement>) => { addFiles(e.target.files); e.target.value = ''; }} /></label><div className="modal-foot"><p>Files up to 2 GB · Uploads may take a little while.</p><div><Button variant="quiet" onClick={closeUpload}>Close</Button><Button onClick={uploadAll} disabled={!drafts.some(d => d.status !== 'done') || requestUpload.isPending || createVideo.isPending}>{requestUpload.isPending || createVideo.isPending ? <><LoaderCircle size={15} className="spin" /> Uploading</> : <><Upload size={15} /> Upload {drafts.filter(d => d.status !== 'done').length} {drafts.filter(d => d.status !== 'done').length === 1 ? 'video' : 'videos'}</>}</Button></div></div></Modal>}
    {modal === 'edit' && <Modal title="Edit video details" subtitle="A small note for the next time this one is ready." onClose={() => setModal(null)}><form className="edit-form" onSubmit={submitEdit}><label>REEL TITLE<input required maxLength={120} value={title} onChange={e => setTitle(e.target.value)} autoFocus /></label><label>DESCRIPTION<textarea maxLength={5000} rows={5} value={description} onChange={e => setDescription(e.target.value)} placeholder="A caption or a thought to keep with it" /></label><div className="modal-foot"><Button variant="quiet" onClick={() => setModal(null)}>Cancel</Button><Button type="submit" disabled={update.isPending}>{update.isPending ? <LoaderCircle size={15} className="spin" /> : <Check size={15} />} Save changes</Button></div></form></Modal>}
    {modal === 'delete' && deleteVideo && <Modal title="Remove this video?" subtitle="This takes it out of your library and rotation. You can add it again later." onClose={() => setModal(null)}><div className="delete-preview"><span className="draft-icon"><Trash2 size={17} /></span><span><strong>{deleteVideo.title}</strong><small>{deleteVideo.originalFilename}</small></span></div><div className="modal-foot"><Button variant="quiet" onClick={() => setModal(null)}>Keep video</Button><Button variant="danger" onClick={confirmDelete} disabled={remove.isPending}>{remove.isPending ? <LoaderCircle size={15} className="spin" /> : <Trash2 size={15} />} Remove video</Button></div></Modal>}
    {modal === 'preview' && <Modal title={videos.find(video => video.id === previewId)?.title || 'Your video'} subtitle="A private preview, just for you." onClose={() => { setModal(null); setPreviewId(0); }} wide>{previewQuery.isLoading ? <div className="preview-loading"><span /><p>Getting your video ready…</p></div> : previewQuery.isError ? <div className="error-panel"><strong>We couldn't open this video.</strong><span>Try again in a moment.</span><Button variant="outline" onClick={() => previewQuery.refetch()}>Try again</Button></div> : previewQuery.data?.url ? <><video className="video-preview" src={previewQuery.data.url} controls playsInline autoPlay /><a className="button button-outline preview-download" href={previewQuery.data.url} download={videos.find(video => video.id === previewId)?.originalFilename || 'lyric-video.mp4'}><Download size={15} /> Download video</a></> : <div className="preview-loading"><p>Waiting for your private preview…</p></div>}</Modal>}
  </AppFrame>;
}

function VideoCard({ video, index, onEdit, onDelete, onPreview, onPosted, onSkip, busy }: { video: Video; index: number; onEdit: () => void; onDelete: () => void; onPreview: () => void; onPosted: () => void; onSkip: () => void; busy: boolean }) {
  const [actionsOpen, setActionsOpen] = useState(false);
  return <article className="video-card animate-rise" style={{ animationDelay: `${Math.min(index, 5) * 65}ms` }} data-testid={`card-video-${video.id}`}><div className={`video-cover cover-${index % 4}`}><div className="cover-film-edge" /><span className="cover-number">{String(index + 1).padStart(2, '0')}</span><div className="cover-wave">{Array.from({ length: 27 }, (_, i) => <i key={i} style={{ height: `${10 + ((index * 19 + i * 37) % 78)}%` }} />)}</div><button className="cover-play" aria-label={`Open ${video.title}`} onClick={onPreview}><Play size={17} fill="currentColor" /></button>{video.isNext && <span className="cover-next"><span /> UP NEXT</span>}<div className="cover-tagline">SIDE A · IN THE MIX</div></div><div className="video-card-body"><div className="video-title-line"><h3>{video.title}</h3><div className="card-menu-wrap"><button className="icon-button card-menu-trigger" aria-label={`More actions for ${video.title}`} aria-expanded={actionsOpen} onClick={() => setActionsOpen(v => !v)}><MoreHorizontal size={19} /></button>{actionsOpen && <><button className="menu-dismiss" aria-label="Close actions" onClick={() => setActionsOpen(false)} /><div className="card-menu"><button onClick={() => { setActionsOpen(false); onEdit(); }}><Pencil size={14} /> Edit details</button><button onClick={() => { setActionsOpen(false); navigator.clipboard.writeText(video.description || video.title).catch(() => undefined); }}><Copy size={14} /> Copy caption</button><button onClick={() => { setActionsOpen(false); onPreview(); }}><Download size={14} /> Download video</button><button onClick={() => { setActionsOpen(false); onDelete(); }}><Trash2 size={14} /> Remove video</button></div></>}</div></div><p className="video-description">{video.description || <span className="muted-italic">No description yet</span>}</p><div className="video-file-meta"><span>{formatBytes(video.sizeBytes)}</span><span>·</span><span>{video.postedCount} {video.postedCount === 1 ? 'share' : 'shares'}</span><span className="meta-spacer" /><span>{readableDate(video.lastPostedAt).split(',')[0]}</span></div>{video.isNext && <div className="video-next-actions"><Button onClick={onPosted} disabled={busy}><Check size={14} /> Mark posted</Button><Button variant="outline" onClick={onSkip} disabled={busy}><SkipForward size={14} /> Skip</Button></div>}</div></article>;
}

function Modal({ title, subtitle, children, onClose, wide = false }: { title: string; subtitle: string; children: ReactNode; onClose: () => void; wide?: boolean }) {
  useEffect(() => { const close = (event: KeyboardEvent) => event.key === 'Escape' && onClose(); window.addEventListener('keydown', close); return () => window.removeEventListener('keydown', close); }, [onClose]);
  return <div className="modal-backdrop" role="presentation" onMouseDown={e => e.target === e.currentTarget && onClose()}><section className={`modal-panel ${wide ? 'modal-wide' : ''}`} role="dialog" aria-modal="true" aria-labelledby="modal-title"><div className="modal-heading"><div><span className="section-index">REELKEEPER / YOUR SPACE</span><h2 id="modal-title">{title}</h2><p>{subtitle}</p></div><button className="icon-button modal-close" aria-label="Close dialog" onClick={onClose}><X size={18} /></button></div>{children}</section></div>;
}

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
    if (!enabled) return 'Your schedule is paused. Turn it back on whenever you’re ready.';
    const next = settings.data?.nextPostAt ? new Date(settings.data.nextPostAt) : new Date(Date.now() + 3 * 3_600_000);
    return `Next scheduled post: ${new Intl.DateTimeFormat(undefined, { weekday: 'long', hour: 'numeric', minute: '2-digit', timeZone: timezone, timeZoneName: 'short' }).format(next)}.`;
  }, [enabled, settings.data?.nextPostAt, timezone]);
  const save = () => {
    const input: ScheduleSettingsInput = { enabled, intervalHours: 3, timezone };
    update.mutate({ data: input }, { onSuccess: data => { client.setQueryData(getGetSettingsQueryKey(), data); void client.invalidateQueries({ queryKey: getGetSettingsQueryKey() }); setChanged(false); setNotice(enabled ? 'Your 3-hour schedule is on.' : 'Your schedule is paused.'); }, onError: () => setNotice('We couldn’t save your schedule. Try again.') });
  };
  const toggle = (event: ChangeEvent<HTMLInputElement>) => { setEnabled(event.target.checked); setChanged(true); };
  const syncFacebook = (data: FacebookStatus, message: string) => {
    client.setQueryData(getGetFacebookStatusQueryKey(), data);
    void client.invalidateQueries({ queryKey: getGetFacebookStatusQueryKey() });
    setNotice(message);
  };
  const connect = () => startConnect.mutate(undefined, {
    onSuccess: result => {
      if (result.authorizationUrl) window.location.assign(result.authorizationUrl);
      else setNotice('Facebook did not return an authorization link. Try again.');
    },
    onError: () => setNotice('Facebook connection could not start. Check the app setup and try again.'),
  });
  const choosePage = (pageId: string) => selectPage.mutate({ data: { pageId } }, {
    onSuccess: data => syncFacebook(data, 'Your Facebook Page selection is saved.'),
    onError: () => setNotice('That Page could not be selected. Try again.'),
  });
  const disconnectPage = () => {
    if (!window.confirm('Disconnect the Facebook Page from Reelkeeper?')) return;
    disconnect.mutate(undefined, {
      onSuccess: data => syncFacebook(data, 'Facebook is disconnected.'),
      onError: () => setNotice('Facebook could not be disconnected. Try again.'),
    });
  };
  const facebookBusy = startConnect.isPending || selectPage.isPending || disconnect.isPending;
  const fbStatus = facebook.data;
  return <AppFrame><PageHeading eyebrow="A RHYTHM THAT'S YOURS" title="Schedule" detail="A steady 3-hour rhythm, with your Page connection in one place." />
    {notice && <Notice message={notice} tone={notice.includes('couldn’t') || notice.includes('could not') || notice.includes('did not') ? 'error' : 'success'} onDismiss={() => setNotice('')} />}
    {settings.isLoading ? <div className="schedule-loading"><div /><div /><div /></div> : settings.isError ? <QueryError retry={() => settings.refetch()} /> : <div className="schedule-layout animate-rise delay-1">
      <div className="schedule-main-column">
        <section className="schedule-form-card"><div className="schedule-form-heading"><span className="section-index">01 / POSTING RHYTHM</span><span className="schedule-icon"><Clock3 size={19} /></span><h2>Keep the cycle moving.</h2><p>Reelkeeper can post the next video to your selected Page every three hours. You can pause any time.</p></div>
          <label className="toggle-row" htmlFor="schedule-enabled"><span><strong>3-hour schedule</strong><small>{enabled ? 'Posting is scheduled while a Page is connected.' : 'Paused until you turn it back on.'}</small></span><span className="switch-wrap"><input id="schedule-enabled" data-testid="input-schedule-enabled" type="checkbox" checked={enabled} onChange={toggle} /><span className="switch-track" /></span></label>
          <div className={`fixed-interval ${!enabled ? 'setting-disabled' : ''}`}><span className="fixed-interval-number">03</span><span><strong>Hours between posts</strong><small>The interval stays simple and consistent.</small></span><span className="fixed-interval-lock">FIXED</span></div>
          <div className={`setting-control timezone-control ${!enabled ? 'setting-disabled' : ''}`}><label htmlFor="timezone">YOUR TIMEZONE</label><div className="hours-control"><select id="timezone" data-testid="select-timezone" disabled={!enabled} value={timezone} onChange={e => { setTimezone(e.target.value); setChanged(true); }}>{timezoneChoices.map(zone => <option key={zone} value={zone}>{zone.replaceAll('_', ' ')}</option>)}</select><ChevronDown size={16} /></div><p>Post times follow this local clock.</p></div>
          <div className="schedule-form-footer"><span>{changed ? 'Unsaved changes' : 'Your settings are up to date'}</span><Button onClick={save} disabled={!changed || update.isPending}>{update.isPending ? <><LoaderCircle size={15} className="spin" /> Saving</> : <><Check size={15} /> Save schedule</>}</Button></div>
        </section>
        <section className="facebook-card" aria-labelledby="facebook-heading">
          <div className="facebook-card-head"><span className="facebook-mark"><Facebook size={18} /></span><div><span className="section-index">02 / FACEBOOK PAGE</span><h2 id="facebook-heading">Your publishing connection</h2></div><span className={`connection-pill ${fbStatus?.connected ? 'connected' : ''}`}><i />{facebook.isLoading ? 'CHECKING' : facebook.isError ? 'STATUS UNKNOWN' : fbStatus?.connected ? 'CONNECTED' : 'NOT CONNECTED'}</span></div>
          {facebook.isLoading ? <div className="fb-skeleton"><i /><i /><i /></div> : facebook.isError ? <div className="fb-error"><CircleAlert size={17} /><span>We couldn’t check your Facebook connection.</span><Button variant="outline" onClick={() => facebook.refetch()}>Try again</Button></div> : <>
            {!fbStatus?.appConfigured && <div className="setup-notice"><CircleAlert size={17} /><p><strong>Facebook connection setup is not complete.</strong> The app needs its Facebook OAuth credentials and a matching callback URL before you can connect. Current callback URL: <code>{fbStatus?.callbackUrl || 'Not provided'}</code></p></div>}
            {fbStatus?.connected ? <div className="connected-content">
              <div className="fb-connected-copy"><ShieldCheck size={18} /><span><strong>Facebook is connected.</strong><small>Choose which Page Reelkeeper should publish to.</small></span></div>
              {fbStatus.pages.length ? <div className="page-choice-list" role="radiogroup" aria-label="Choose a Facebook Page">{fbStatus.pages.map(page => <label key={page.pageId} className={`page-choice ${page.selected ? 'page-choice-selected' : ''}`}><span className="page-radio"><input type="radio" name="facebook-page" value={page.pageId} checked={page.selected} disabled={facebookBusy} onChange={() => choosePage(page.pageId)} /><i /></span><span className="page-choice-copy"><strong>{page.pageName}</strong><small>Page · {page.pageId}</small></span>{page.selected && <span className="selected-label"><Check size={13} /> SELECTED</span>}</label>)}</div> : <p className="no-pages">No Pages were returned for this connection. Check the Facebook account’s Page access and reconnect if needed.</p>}
              <div className="facebook-actions"><Button variant="quiet" onClick={disconnectPage} disabled={facebookBusy}>{disconnect.isPending ? <LoaderCircle size={15} className="spin" /> : <X size={15} />} Disconnect Page</Button></div>
            </div> : <div className="facebook-connect-row"><div><strong>Connect the Page you manage</strong><p>Reelkeeper will use the authorization provided by Facebook. You can disconnect at any time.</p></div><Button onClick={connect} disabled={!fbStatus?.appConfigured || facebookBusy}>{startConnect.isPending ? <><LoaderCircle size={15} className="spin" /> Connecting</> : <><Facebook size={15} /> Connect Facebook</>}</Button></div>}
            <div className={`insights-status ${fbStatus?.viewInsightsAvailable ? 'insights-available' : ''}`}><span className="insights-indicator" /><div><strong>{fbStatus?.viewInsightsAvailable ? 'View insights available' : 'View insights not available'}</strong><p>{fbStatus?.viewInsightsAvailable ? (fbStatus.viewInsightsMessage || 'Page view counts can be used when available.') : (fbStatus?.viewInsightsMessage || 'Optional access. Posting can continue without view insights.')}</p></div></div>
            {fbStatus?.lastError && <p className="facebook-last-error" role="status"><CircleAlert size={15} />{fbStatus.lastError}</p>}
          </>}
        </section>
      </div>
      <aside className="schedule-aside"><div className="schedule-preview"><span className="section-index">03 / NEXT POST</span><div className="preview-clock"><span className="clock-hand hand-hour" /><span className="clock-hand hand-minute" /><span className="clock-center" /><span className="clock-tick tick-12" /><span className="clock-tick tick-3" /><span className="clock-tick tick-6" /><span className="clock-tick tick-9" /></div><h3>{enabled ? 'Every 3 hours' : 'Whenever you’re ready'}</h3><p>{schedulePreview}</p><div className={`schedule-status ${enabled ? 'status-on' : 'status-off'}`}><span />{enabled ? 'SCHEDULE ON' : 'SCHEDULE PAUSED'}</div></div>
        <div className="schedule-honesty"><span><ShieldCheck size={17} /></span><div><strong>Clear about access.</strong><p>Facebook authorization is required to publish. View insights are optional; Reelkeeper shows when that access is unavailable.</p></div></div>
        <div className="last-activity"><span className="section-index">LAST POSTED</span><strong>{readableDate(settings.data?.lastPostedAt)}</strong>{settings.data?.lastPostVideoTitle && <small>{settings.data.lastPostVideoTitle}</small>}</div>
      </aside>
    </div>}
  </AppFrame>;
}

export default App;
