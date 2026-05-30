import {
  BarChart3,
  BriefcaseBusiness,
  CheckCircle2,
  Clipboard,
  Download,
  FileText,
  Inbox,
  ListFilter,
  Mail,
  Plus,
  RefreshCcw,
  Save,
  Search,
  Send,
  Sparkles,
  Star,
  Target,
  Trash2,
  Upload,
  XCircle,
} from 'lucide-react';
import type { ReactNode } from 'react';
import { FormEvent, useEffect, useMemo, useState } from 'react';
import './App.css';

type Status = 'Saved' | 'Shortlisted' | 'Ready' | 'Applied' | 'Interview' | 'Rejected' | 'Offer' | 'Skipped';
type Priority = 'High' | 'Medium' | 'Low';
type SyncStatus = 'Local' | 'Saving' | 'Server' | 'Offline';

interface JobApplication {
  id: string;
  title: string;
  company: string;
  location: string;
  url: string;
  description: string;
  sponsorship: boolean;
  status: Status;
  priority: Priority;
  score: number;
  matchedKeywords: string[];
  missingKeywords: string[];
  resumeBullets: string[];
  coverLetter: string;
  recruiterMessage: string;
  notes: string;
  createdAt: string;
  appliedAt?: string;
  followUpAt?: string;
  interviewAt?: string;
}

interface AnalysisResult {
  score: number;
  priority: Priority;
  matchedKeywords: string[];
  missingKeywords: string[];
  resumeBullets: string[];
  coverLetter: string;
  recruiterMessage: string;
}

interface AiDraft {
  resumeBullets: string[];
  coverLetter: string;
  recruiterMessage: string;
  fitNotes?: string[];
}

interface JobForm {
  title: string;
  company: string;
  location: string;
  url: string;
  description: string;
  sponsorship: boolean;
}

interface ImportedJob extends JobForm {
  sourceBlock: string;
}

interface ProfileVersion {
  id: string;
  name: string;
  content: string;
  source: string;
  createdAt: string;
}

interface GmailMessageSummary {
  id: string;
  subject: string;
  from: string;
  date: string;
  jobsFound: number;
  snippet?: string;
}

interface AppState {
  applications: JobApplication[];
  dailyTarget: number;
  profile: string;
  activeProfileId?: string | null;
  profileVersions?: ProfileVersion[];
  isStored?: boolean;
}

const emptyForm: JobForm = {
  title: '',
  company: '',
  location: 'Singapore',
  url: '',
  description: '',
  sponsorship: false,
};

const profileSummary = `Java and Spring Boot backend developer with banking and finance domain experience. Built full-stack applications with Angular, React-ready frontend patterns, REST APIs, PostgreSQL, Docker, Kubernetes, Argo CD, GitHub Actions, Render, and AWS EC2/ECR/SSM deployments. Comfortable with CI/CD, cloud troubleshooting, API integration, and production-style deployment workflows.`;

const skillDictionary: Record<string, string[]> = {
  Java: ['java', 'jvm', 'jdk'],
  'Spring Boot': ['spring boot', 'spring framework', 'spring'],
  'REST APIs': ['rest', 'restful', 'api', 'apis', 'microservice', 'microservices'],
  SQL: ['sql', 'postgres', 'postgresql', 'mysql', 'oracle', 'database'],
  Docker: ['docker', 'container', 'containers', 'containerized'],
  Kubernetes: ['kubernetes', 'k8s', 'argo', 'argocd', 'helm'],
  AWS: ['aws', 'ec2', 'ecr', 'iam', 'ssm', 'cloud'],
  'CI/CD': ['ci/cd', 'cicd', 'github actions', 'jenkins', 'pipeline', 'deployment'],
  Finance: ['bank', 'banking', 'finance', 'financial', 'payments', 'trading'],
  React: ['react', 'typescript', 'javascript', 'frontend'],
  Agile: ['agile', 'scrum', 'jira'],
  Testing: ['junit', 'unit test', 'testing', 'integration test'],
};

const targetRoles = [
  'Java Developer',
  'Backend Engineer',
  'Spring Boot Developer',
  'Full Stack Java Developer',
  'Software Engineer - Banking',
  'Platform Engineer',
  'DevOps Engineer',
  'Kubernetes Engineer',
];

const statuses: Status[] = ['Saved', 'Shortlisted', 'Ready', 'Applied', 'Interview', 'Rejected', 'Offer', 'Skipped'];

const statusLabels: Record<Status, string> = {
  Saved: 'Saved',
  Shortlisted: 'Shortlisted',
  Ready: 'Ready to Apply',
  Applied: 'Applied',
  Interview: 'Interview',
  Rejected: 'Rejected',
  Offer: 'Offer',
  Skipped: 'Skipped',
};

function loadApplications(): JobApplication[] {
  const raw = localStorage.getItem('applypilot.applications');

  if (!raw) {
    return [];
  }

  try {
    return JSON.parse(raw) as JobApplication[];
  } catch {
    return [];
  }
}

function loadDailyTarget(): number {
  const value = Number(localStorage.getItem('applypilot.dailyTarget'));
  return Number.isFinite(value) && value > 0 ? value : 10;
}

function loadProfile(): string {
  return localStorage.getItem('applypilot.profile') ?? profileSummary;
}

function loadLocalState(): AppState {
  return {
    applications: loadApplications(),
    dailyTarget: loadDailyTarget(),
    profile: loadProfile(),
  };
}

function appStateFromPayload(payload: unknown, fallback: AppState): AppState {
  const state = payload as Partial<AppState>;
  const dailyTarget = Number(state.dailyTarget);

  return {
    applications: Array.isArray(state.applications) ? state.applications : fallback.applications,
    dailyTarget: Number.isFinite(dailyTarget) && dailyTarget > 0 ? dailyTarget : fallback.dailyTarget,
    profile: typeof state.profile === 'string' && state.profile.trim() ? state.profile : fallback.profile,
    activeProfileId: typeof state.activeProfileId === 'string' ? state.activeProfileId : fallback.activeProfileId,
    profileVersions: Array.isArray(state.profileVersions) ? state.profileVersions : fallback.profileVersions,
    isStored: Boolean(state.isStored),
  };
}

function todayDate(): string {
  return new Date().toISOString().slice(0, 10);
}

function addDays(date: Date, days: number): string {
  const copy = new Date(date);
  copy.setDate(copy.getDate() + days);
  return copy.toISOString().slice(0, 10);
}

function normalize(value: string): string {
  return value.toLowerCase();
}

function parseLinkedInAlertEmail(rawEmail: string): ImportedJob[] {
  const normalizedEmail = rawEmail.replace(/\r\n/g, '\n');
  const lines = normalizedEmail
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  const urlIndexes = lines
    .map((line, index) => ({ line, index }))
    .filter(({ line }) => /https?:\/\/\S+/i.test(line))
    .filter(({ line }) => /linkedin\.com|lnkd\.in/i.test(line));

  const jobs = urlIndexes
    .map(({ line, index }) => {
      const url = cleanUrl(line.match(/https?:\/\/\S+/i)?.[0] ?? '');
      const blockLines = lines.slice(Math.max(0, index - 8), Math.min(lines.length, index + 4));
      return buildImportedJob(blockLines, url);
    })
    .filter((job): job is ImportedJob => Boolean(job));

  if (jobs.length > 0) {
    return uniqueImportedJobs(jobs);
  }

  const blocks = normalizedEmail
    .split(/\n\s*\n/g)
    .map((block) => block.split('\n').map((line) => line.trim()).filter(Boolean))
    .filter((block) => block.length >= 2);

  return uniqueImportedJobs(
    blocks
      .map((block) => buildImportedJob(block, ''))
      .filter((job): job is ImportedJob => Boolean(job)),
  );
}

function buildImportedJob(blockLines: string[], url: string): ImportedJob | null {
  const cleanLines = blockLines
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .filter((line) => !/https?:\/\//i.test(line))
    .filter((line) => !isEmailNoiseLine(line));

  if (cleanLines.length === 0) {
    return null;
  }

  const titleIndex = cleanLines.findIndex(isRoleLine);
  const title = cleanLines[titleIndex >= 0 ? titleIndex : 0];

  if (!title || title.length < 3) {
    return null;
  }

  const afterTitle = cleanLines.slice((titleIndex >= 0 ? titleIndex : 0) + 1);
  const location = afterTitle.find(isLocationLine) ?? cleanLines.find(isLocationLine) ?? 'Singapore';
  const company = afterTitle.find((line) => !isLocationLine(line) && !isEmailMetadataLine(line)) ?? 'Unknown company';
  const sourceBlock = blockLines.join('\n');

  return {
    title: titleFromLine(title),
    company: companyFromLine(company),
    location,
    url,
    description: sourceBlock,
    sponsorship: /sponsor|employment pass|work pass|ep\b/i.test(sourceBlock),
    sourceBlock,
  };
}

function uniqueImportedJobs(jobs: ImportedJob[]): ImportedJob[] {
  const seen = new Set<string>();
  const uniqueJobs: ImportedJob[] = [];

  for (const job of jobs) {
    const key = job.url || `${normalize(job.title)}:${normalize(job.company)}`;

    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    uniqueJobs.push(job);
  }

  return uniqueJobs;
}

function cleanUrl(url: string): string {
  return url.replace(/[),.;\]]+$/g, '');
}

function titleFromLine(line: string): string {
  return line.replace(/^job alert:?\s*/i, '').trim();
}

function companyFromLine(line: string): string {
  return line.replace(/^company:?\s*/i, '').trim();
}

function isRoleLine(line: string): boolean {
  return /developer|engineer|programmer|architect|analyst|consultant|java|spring|backend|software|platform|devops|full stack|full-stack/i.test(line);
}

function isLocationLine(line: string): boolean {
  return /singapore|remote|hybrid|on-site|onsite|asia|apac|cbd/i.test(line);
}

function isEmailMetadataLine(line: string): boolean {
  return /full-time|part-time|contract|temporary|internship|remote|hybrid|on-site|onsite|applicants?|applicant|promoted|posted|ago|easy apply/i.test(line);
}

function isEmailNoiseLine(line: string): boolean {
  if (/^job alert:?\s+.+/i.test(line)) {
    return false;
  }

  return (
    isEmailMetadataLine(line) ||
    /linkedin|view job|view jobs|apply now|see more|job alert|recommended for you|based on your profile|unsubscribe|manage alerts|privacy|help center|copyright|download the app|this email|notification|new jobs|jobs for you|similar jobs|be an early applicant|actively hiring/i.test(
      line,
    )
  );
}

function analyzeJob(form: JobForm, profile: string): AnalysisResult {
  const text = normalize(`${form.title} ${form.company} ${form.location} ${form.description}`);
  const matchedKeywords = Object.entries(skillDictionary)
    .filter(([, variants]) => variants.some((keyword) => text.includes(keyword)))
    .map(([skill]) => skill);

  const missingKeywords = Object.keys(skillDictionary)
    .filter((skill) => !matchedKeywords.includes(skill))
    .slice(0, 6);

  const titleText = normalize(form.title);
  const roleBonus = targetRoles.some((role) => titleText.includes(normalize(role.replace(' - ', ' '))))
    ? 12
    : titleText.includes('java') || titleText.includes('backend') || titleText.includes('software')
      ? 8
      : 0;
  const singaporeBonus = text.includes('singapore') ? 6 : 0;
  const sponsorshipBonus = form.sponsorship ? 6 : 0;
  const financeBonus = matchedKeywords.includes('Finance') ? 6 : 0;
  const score = Math.min(
    100,
    Math.round(matchedKeywords.length * 8 + roleBonus + singaporeBonus + sponsorshipBonus + financeBonus),
  );
  const priority: Priority = score >= 70 ? 'High' : score >= 45 ? 'Medium' : 'Low';
  const title = form.title || 'the role';
  const company = form.company || 'your team';
  const profileLead = profile.split('.').find(Boolean)?.trim() ?? profileSummary.split('.').find(Boolean)?.trim();
  const strongestSkills = matchedKeywords.slice(0, 5);

  const resumeBullets = buildResumeBullets(strongestSkills, title);
  const coverLetter = buildCoverLetter(title, company, strongestSkills, profileLead);
  const recruiterMessage = buildRecruiterMessage(title, company, strongestSkills);

  return {
    score,
    priority,
    matchedKeywords,
    missingKeywords,
    resumeBullets,
    coverLetter,
    recruiterMessage,
  };
}

function buildResumeBullets(skills: string[], title: string): string[] {
  const bullets = [
    'Built and deployed full-stack applications using Java, Spring Boot, REST APIs, Docker, and cloud hosting workflows.',
    'Implemented production-style CI/CD and container deployment flows using GitHub Actions, Docker registries, Kubernetes, Argo CD, and AWS services.',
    'Integrated external APIs and designed backend services for search, real-time data retrieval, and route-planning style business logic.',
  ];

  if (skills.includes('Finance')) {
    bullets.unshift('Applied banking and finance domain knowledge to backend engineering workflows, data handling, and production support expectations.');
  }

  if (skills.includes('React')) {
    bullets.push('Delivered frontend interfaces with TypeScript-based component design, responsive layouts, and API-driven state management.');
  }

  if (skills.includes('AWS')) {
    bullets.push('Configured AWS EC2, ECR, IAM, SSM Parameter Store, and security groups to deploy containerized applications.');
  }

  return bullets.slice(0, title.toLowerCase().includes('senior') ? 5 : 4);
}

function buildCoverLetter(title: string, company: string, skills: string[], lead?: string): string {
  const skillText = skills.length > 0 ? skills.slice(0, 5).join(', ') : 'Java, Spring Boot, REST APIs, Docker, and cloud deployments';

  return [
    `Dear Hiring Team,`,
    '',
    `I am interested in the ${title} position at ${company}. ${lead ?? profileSummary.split('.')[0]}.`,
    '',
    `The role aligns well with my experience in ${skillText}. Recently, I built and deployed a full-stack transport application with API integration, Docker, Kubernetes/Argo CD learning workflows, GitHub Actions, Render, and AWS EC2/ECR/SSM deployment experience.`,
    '',
    `I would welcome the chance to discuss how my backend engineering, cloud deployment, and finance-domain experience can contribute to your team.`,
    '',
    `Best regards,`,
  ].join('\n');
}

function buildRecruiterMessage(title: string, company: string, skills: string[]): string {
  const skillText = skills.length > 0 ? skills.slice(0, 4).join(', ') : 'Java, Spring Boot, Docker, and AWS';

  return `Hi, I am interested in the ${title} role at ${company}. My background includes ${skillText}, plus banking/finance domain experience and recent hands-on deployments with Docker, Kubernetes, GitHub Actions, Render, and AWS. I would be glad to connect and share more.`;
}

function escapeCsv(value: string | number | boolean | undefined): string {
  const text = String(value ?? '');
  return `"${text.replace(/"/g, '""')}"`;
}

function toCsv(applications: JobApplication[]): string {
  const headers = [
    'Title',
    'Company',
    'Location',
    'URL',
    'Status',
    'Priority',
    'Score',
    'Sponsorship',
    'Created At',
    'Applied At',
    'Interview At',
    'Follow Up At',
    'Matched Keywords',
    'Notes',
  ];
  const rows = applications.map((application) => [
    application.title,
    application.company,
    application.location,
    application.url,
    statusLabel(application.status),
    application.priority,
    application.score,
    application.sponsorship,
    application.createdAt,
    application.appliedAt,
    application.interviewAt,
    application.followUpAt,
    application.matchedKeywords.join(', '),
    application.notes,
  ]);

  return [headers, ...rows].map((row) => row.map(escapeCsv).join(',')).join('\n');
}

function downloadCsv(applications: JobApplication[]): void {
  const blob = new Blob([toCsv(applications)], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `applications-${todayDate()}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

function statusLabel(status: Status): string {
  return statusLabels[status];
}

function syncStatusLabel(status: SyncStatus): string {
  if (status === 'Server') {
    return 'Saved to file';
  }

  if (status === 'Saving') {
    return 'Saving';
  }

  if (status === 'Offline') {
    return 'Browser only';
  }

  return 'Local';
}

function formatShortDate(date: string): string {
  return new Date(`${date}T00:00:00`).toLocaleDateString('en-SG', {
    day: '2-digit',
    month: 'short',
  });
}

async function extractPdfText(file: File): Promise<string> {
  const [pdfjsLib, worker] = await Promise.all([
    import('pdfjs-dist'),
    import('pdfjs-dist/build/pdf.worker.mjs?url'),
  ]);
  const data = new Uint8Array(await file.arrayBuffer());
  pdfjsLib.GlobalWorkerOptions.workerSrc = worker.default;

  const document = await pdfjsLib.getDocument({ data }).promise;
  const pages: string[] = [];

  for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
    const page = await document.getPage(pageNumber);
    const textContent = await page.getTextContent();
    const pageText = textContent.items
      .map((item) => ('str' in item ? item.str : ''))
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();

    if (pageText) {
      pages.push(pageText);
    }
  }

  return pages.join('\n\n');
}

function App() {
  const [applications, setApplications] = useState<JobApplication[]>(loadApplications);
  const [activeProfileId, setActiveProfileId] = useState<string | null>(null);
  const [aiDraft, setAiDraft] = useState<AiDraft | null>(null);
  const [aiError, setAiError] = useState('');
  const [aiLoading, setAiLoading] = useState(false);
  const [dailyTarget, setDailyTarget] = useState(loadDailyTarget);
  const [emailImportText, setEmailImportText] = useState('');
  const [emailImportMessage, setEmailImportMessage] = useState('');
  const [form, setForm] = useState<JobForm>(emptyForm);
  const [gmailLoading, setGmailLoading] = useState(false);
  const [gmailMaxResults, setGmailMaxResults] = useState(10);
  const [gmailMessage, setGmailMessage] = useState('');
  const [gmailPreviewJobs, setGmailPreviewJobs] = useState<ImportedJob[]>([]);
  const [gmailQuery, setGmailQuery] = useState('in:anywhere from:(jobalerts-noreply@linkedin.com) newer_than:30d');
  const [gmailScannedMessages, setGmailScannedMessages] = useState<GmailMessageSummary[]>([]);
  const [notes, setNotes] = useState('');
  const [profile, setProfile] = useState(loadProfile);
  const [profileName, setProfileName] = useState('Main profile');
  const [profileVersions, setProfileVersions] = useState<ProfileVersion[]>([]);
  const [profileVersionMessage, setProfileVersionMessage] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [serverHydrated, setServerHydrated] = useState(false);
  const [serverReady, setServerReady] = useState(false);
  const [statusFilter, setStatusFilter] = useState<Status | 'All'>('All');
  const [syncStatus, setSyncStatus] = useState<SyncStatus>('Local');
  const [query, setQuery] = useState('');
  const analysis = useMemo(() => analyzeJob(form, profile), [form, profile]);
  const activeDraft = aiDraft ?? {
    resumeBullets: analysis.resumeBullets,
    coverLetter: analysis.coverLetter,
    recruiterMessage: analysis.recruiterMessage,
  };
  const importedJobs = useMemo(() => parseLinkedInAlertEmail(emailImportText), [emailImportText]);
  const importableJobs = useMemo(
    () =>
      importedJobs.filter(
        (job) =>
          !applications.some(
            (application) =>
              (job.url && application.url === job.url) ||
              `${normalize(application.title)}:${normalize(application.company)}` ===
                `${normalize(job.title)}:${normalize(job.company)}`,
          ),
      ),
    [applications, importedJobs],
  );
  const gmailImportableJobs = useMemo(
    () =>
      gmailPreviewJobs.filter(
        (job) =>
          !applications.some(
            (application) =>
              (job.url && application.url === job.url) ||
              `${normalize(application.title)}:${normalize(application.company)}` ===
                `${normalize(job.title)}:${normalize(job.company)}`,
          ),
      ),
    [applications, gmailPreviewJobs],
  );
  const selectedApplication = applications.find((application) => application.id === selectedId) ?? applications[0];

  useEffect(() => {
    let cancelled = false;

    async function loadServerState(): Promise<void> {
      const localState = loadLocalState();

      try {
        const response = await fetch('/api/state');

        if (!response.ok) {
          throw new Error('State server is unavailable.');
        }

        const payload = await response.json();
        const serverState = appStateFromPayload(payload, localState);
        const shouldUseLocalState = !serverState.isStored;
        const nextState = shouldUseLocalState
          ? localState
          : {
              applications: serverState.applications,
              dailyTarget: serverState.dailyTarget,
              profile: serverState.profile,
              activeProfileId: serverState.activeProfileId,
              profileVersions: serverState.profileVersions,
            };

        if (cancelled) {
          return;
        }

        setApplications(nextState.applications);
        setDailyTarget(nextState.dailyTarget);
        setProfile(nextState.profile);
        setActiveProfileId(nextState.activeProfileId ?? null);
        setProfileVersions(nextState.profileVersions ?? []);
        setSelectedId(nextState.applications[0]?.id ?? null);
        setServerReady(true);
        setSyncStatus(shouldUseLocalState ? 'Saving' : 'Server');
      } catch {
        if (!cancelled) {
          setServerReady(false);
          setSyncStatus('Offline');
        }
      } finally {
        if (!cancelled) {
          setServerHydrated(true);
        }
      }
    }

    loadServerState();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    localStorage.setItem('applypilot.applications', JSON.stringify(applications));
  }, [applications]);

  useEffect(() => {
    localStorage.setItem('applypilot.dailyTarget', String(dailyTarget));
  }, [dailyTarget]);

  useEffect(() => {
    localStorage.setItem('applypilot.profile', profile);
  }, [profile]);

  useEffect(() => {
    let cancelled = false;

    async function loadGmailSettings(): Promise<void> {
      try {
        const response = await fetch('/api/gmail/settings');

        if (!response.ok) {
          return;
        }

        const payload = await response.json();

        if (cancelled) {
          return;
        }

        if (typeof payload.query === 'string' && payload.query.trim()) {
          setGmailQuery(payload.query);
        }

        if (Number.isFinite(Number(payload.maxResults))) {
          setGmailMaxResults(Number(payload.maxResults));
        }
      } catch {
        // Gmail settings are optional; keep local defaults if the server is unavailable.
      }
    }

    loadGmailSettings();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!serverHydrated || !serverReady) {
      return undefined;
    }

    const controller = new AbortController();
    const timeoutId = window.setTimeout(async () => {
      setSyncStatus('Saving');

      try {
        const response = await fetch('/api/state', {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            applications,
            dailyTarget,
            profile,
          }),
          signal: controller.signal,
        });

        if (!response.ok) {
          throw new Error('Unable to save tracker state.');
        }

        setSyncStatus('Server');
      } catch {
        if (!controller.signal.aborted) {
          setServerReady(false);
          setSyncStatus('Offline');
        }
      }
    }, 500);

    return () => {
      window.clearTimeout(timeoutId);
      controller.abort();
    };
  }, [applications, dailyTarget, profile, serverHydrated, serverReady]);

  useEffect(() => {
    setAiDraft(null);
    setAiError('');
  }, [form, profile]);

  const stats = useMemo(() => {
    const today = todayDate();
    const appliedToday = applications.filter((application) => application.appliedAt === today).length;
    const saved = applications.filter((application) => application.status === 'Saved').length;
    const shortlisted = applications.filter((application) => application.status === 'Shortlisted').length;
    const ready = applications.filter((application) => application.status === 'Ready').length;
    const followUpsDue = applications.filter(
      (application) =>
        application.followUpAt &&
        application.followUpAt <= today &&
        !['Rejected', 'Offer', 'Skipped'].includes(application.status),
    ).length;

    return { appliedToday, saved, shortlisted, ready, followUpsDue };
  }, [applications]);

  const remainingTarget = Math.max(0, dailyTarget - stats.appliedToday);
  const todayPlan = useMemo(() => {
    const statusRank: Record<Status, number> = {
      Ready: 0,
      Shortlisted: 1,
      Saved: 2,
      Interview: 3,
      Applied: 4,
      Offer: 5,
      Rejected: 6,
      Skipped: 7,
    };

    return applications
      .filter((application) => ['Saved', 'Shortlisted', 'Ready'].includes(application.status))
      .sort(
        (left, right) =>
          statusRank[left.status] - statusRank[right.status] ||
          right.score - left.score ||
          right.createdAt.localeCompare(left.createdAt),
      )
      .slice(0, remainingTarget);
  }, [applications, remainingTarget]);

  const weeklyStats = useMemo(() => {
    const today = new Date();
    const days = Array.from({ length: 7 }, (_, index) => {
      const date = new Date(today);
      date.setDate(today.getDate() - (6 - index));
      return date.toISOString().slice(0, 10);
    });
    const rows = days.map((date) => ({
      date,
      applied: applications.filter((application) => application.appliedAt === date).length,
      interviews: applications.filter((application) => application.interviewAt === date).length,
    }));
    const maxValue = Math.max(1, ...rows.flatMap((row) => [row.applied, row.interviews]));

    return rows.map((row) => ({
      ...row,
      appliedHeight: `${Math.max(8, (row.applied / maxValue) * 100)}%`,
      interviewHeight: `${Math.max(8, (row.interviews / maxValue) * 100)}%`,
    }));
  }, [applications]);

  const filteredApplications = useMemo(() => {
    const normalizedQuery = normalize(query);

    return applications
      .filter((application) => statusFilter === 'All' || application.status === statusFilter)
      .filter((application) =>
        [
          application.title,
          application.company,
          application.location,
          application.status,
          application.priority,
          application.matchedKeywords.join(' '),
        ]
          .join(' ')
          .toLowerCase()
          .includes(normalizedQuery),
      )
      .sort((left, right) => right.score - left.score || right.createdAt.localeCompare(left.createdAt));
  }, [applications, query, statusFilter]);

  function updateForm(field: keyof JobForm, value: string | boolean): void {
    setForm((current) => ({ ...current, [field]: value }));
  }

  function saveApplication(event?: FormEvent<HTMLFormElement>): void {
    event?.preventDefault();

    if (!form.title.trim() || !form.company.trim() || !form.description.trim()) {
      return;
    }

    const now = new Date();
    const application: JobApplication = {
      id: crypto.randomUUID(),
      ...form,
      status: 'Ready',
      priority: analysis.priority,
      score: analysis.score,
      matchedKeywords: analysis.matchedKeywords,
      missingKeywords: analysis.missingKeywords,
      resumeBullets: activeDraft.resumeBullets,
      coverLetter: activeDraft.coverLetter,
      recruiterMessage: activeDraft.recruiterMessage,
      notes,
      createdAt: now.toISOString().slice(0, 10),
      followUpAt: addDays(now, 7),
    };

    setApplications((current) => [application, ...current]);
    setSelectedId(application.id);
    setForm(emptyForm);
    setNotes('');
  }

  async function generateAiDraft(): Promise<void> {
    if (!form.title.trim() || !form.company.trim() || !form.description.trim()) {
      setAiError('Add a role, company, and job description first.');
      return;
    }

    setAiError('');
    setAiLoading(true);

    try {
      const response = await fetch('/api/tailor', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          profile,
          job: form,
        }),
      });
      const payload = await response.json();

      if (!response.ok) {
        throw new Error(payload.error ?? 'Unable to generate AI draft.');
      }

      setAiDraft({
        resumeBullets: Array.isArray(payload.resumeBullets) ? payload.resumeBullets : analysis.resumeBullets,
        coverLetter: String(payload.coverLetter ?? analysis.coverLetter),
        recruiterMessage: String(payload.recruiterMessage ?? analysis.recruiterMessage),
        fitNotes: Array.isArray(payload.fitNotes) ? payload.fitNotes.map(String) : [],
      });
    } catch (error) {
      setAiError(error instanceof Error ? error.message : 'Unable to generate AI draft.');
    } finally {
      setAiLoading(false);
    }
  }

  function addImportedJobs(jobs: ImportedJob[], sourceNote: string): number {
    const now = new Date();
    const uniqueJobs = jobs.filter(
      (job) =>
        !applications.some(
          (application) =>
            (job.url && application.url === job.url) ||
            `${normalize(application.title)}:${normalize(application.company)}` ===
              `${normalize(job.title)}:${normalize(job.company)}`,
        ),
    );
    const newApplications = uniqueJobs.map((job) => {
      const jobAnalysis = analyzeJob(job, profile);

      return {
        id: crypto.randomUUID(),
        title: job.title,
        company: job.company,
        location: job.location,
        url: job.url,
        description: job.description,
        sponsorship: job.sponsorship,
        status: 'Saved' as Status,
        priority: jobAnalysis.priority,
        score: jobAnalysis.score,
        matchedKeywords: jobAnalysis.matchedKeywords,
        missingKeywords: jobAnalysis.missingKeywords,
        resumeBullets: jobAnalysis.resumeBullets,
        coverLetter: jobAnalysis.coverLetter,
        recruiterMessage: jobAnalysis.recruiterMessage,
        notes: sourceNote,
        createdAt: now.toISOString().slice(0, 10),
        followUpAt: addDays(now, 7),
      };
    });

    if (newApplications.length === 0) {
      return 0;
    }

    setApplications((current) => [...newApplications, ...current]);
    setSelectedId(newApplications[0]?.id ?? null);
    return newApplications.length;
  }

  function importEmailJobs(): void {
    if (importableJobs.length === 0) {
      setEmailImportMessage(
        importedJobs.length > 0 ? 'All parsed jobs are already in the tracker.' : 'No jobs found in this email.',
      );
      return;
    }

    const importedCount = addImportedJobs(
      importableJobs,
      'Imported from LinkedIn email alert. Open the job post manually and verify details before applying.',
    );
    setEmailImportMessage(`Imported ${importedCount} job${importedCount === 1 ? '' : 's'}.`);
  }

  async function saveProfileVersion(content = profile, source = 'manual', name = profileName): Promise<void> {
    if (!content.trim()) {
      setProfileVersionMessage('Profile text is empty.');
      return;
    }

    try {
      const response = await fetch('/api/profiles', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name: name.trim() || 'Profile version',
          content,
          source,
          makeActive: true,
        }),
      });
      const payload = await response.json();

      if (!response.ok) {
        throw new Error(payload.error ?? 'Unable to save profile version.');
      }

      setProfile(payload.content);
      setActiveProfileId(payload.id);
      setProfileVersions((current) => [payload, ...current.filter((version) => version.id !== payload.id)]);
      setProfileVersionMessage(`Saved ${payload.name}.`);
    } catch (error) {
      setProfileVersionMessage(error instanceof Error ? error.message : 'Unable to save profile version.');
    }
  }

  async function activateProfileVersion(profileId: string): Promise<void> {
    try {
      const response = await fetch(`/api/profiles/${profileId}/activate`, {
        method: 'POST',
      });
      const payload = await response.json();

      if (!response.ok) {
        throw new Error(payload.error ?? 'Unable to activate profile version.');
      }

      setProfile(payload.profile);
      setActiveProfileId(payload.activeProfileId);
      setProfileVersions(payload.profileVersions ?? []);
      setProfileVersionMessage('Profile version activated.');
    } catch (error) {
      setProfileVersionMessage(error instanceof Error ? error.message : 'Unable to activate profile version.');
    }
  }

  async function handleResumeUpload(file: File | undefined): Promise<void> {
    if (!file) {
      return;
    }

    if (!/\.(txt|md|markdown|pdf)$/i.test(file.name)) {
      setProfileVersionMessage('Upload a PDF, text, or Markdown resume.');
      return;
    }

    try {
      setProfileVersionMessage(`Reading ${file.name}...`);
      const content = /\.pdf$/i.test(file.name) ? await extractPdfText(file) : await file.text();

      if (!content.trim()) {
        setProfileVersionMessage('No readable text was found in this file.');
        return;
      }

      setProfile(content);
      setProfileName(file.name.replace(/\.(txt|md|markdown|pdf)$/i, ''));
      await saveProfileVersion(content, /\.pdf$/i.test(file.name) ? 'pdf-upload' : 'resume-upload', file.name);
    } catch (error) {
      setProfileVersionMessage(error instanceof Error ? error.message : 'Unable to read this resume file.');
    }
  }

  async function connectGmail(): Promise<void> {
    setGmailMessage('');

    try {
      await saveGmailSettings();
      const response = await fetch('/api/gmail/auth-url');
      const payload = await response.json();

      if (!response.ok) {
        throw new Error(payload.error ?? 'Gmail OAuth is not configured.');
      }

      window.open(payload.url, '_blank', 'noopener,noreferrer');
      setGmailMessage('Gmail connection opened in a new tab. After approving, return here and import.');
    } catch (error) {
      setGmailMessage(error instanceof Error ? error.message : 'Unable to connect Gmail.');
    }
  }

  async function saveGmailSettings(): Promise<void> {
    await fetch('/api/gmail/settings', {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        query: gmailQuery,
        maxResults: gmailMaxResults,
      }),
    });
  }

  async function scanGmailJobs(): Promise<void> {
    setGmailLoading(true);
    setGmailMessage('');

    try {
      await saveGmailSettings();
      const response = await fetch('/api/gmail/import', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          query: gmailQuery,
          maxResults: gmailMaxResults,
        }),
      });
      const payload = await response.json();

      if (!response.ok) {
        throw new Error(payload.error ?? 'Unable to import Gmail jobs.');
      }

      const jobs = Array.isArray(payload.jobs) ? payload.jobs : [];
      const scannedMessages = Array.isArray(payload.scannedMessages) ? payload.scannedMessages : [];
      setGmailPreviewJobs(jobs);
      setGmailScannedMessages(scannedMessages);
      const usedQueryNote =
        typeof payload.query === 'string' && payload.query !== gmailQuery ? ` Used fallback query: ${payload.query}.` : '';
      setGmailMessage(
        `Scanned ${payload.messagesScanned ?? 0} email${payload.messagesScanned === 1 ? '' : 's'} and found ${jobs.length} job${
          jobs.length === 1 ? '' : 's'
        }.${usedQueryNote}`,
      );
    } catch (error) {
      setGmailMessage(error instanceof Error ? error.message : 'Unable to import Gmail jobs.');
    } finally {
      setGmailLoading(false);
    }
  }

  function importGmailPreviewJobs(): void {
    if (gmailImportableJobs.length === 0) {
      setGmailMessage(
        gmailPreviewJobs.length > 0 ? 'All Gmail preview jobs are already in the tracker.' : 'Scan Gmail before importing.',
      );
      return;
    }

    const importedCount = addImportedJobs(
      gmailImportableJobs,
      'Imported from Gmail LinkedIn alert. Open the job post manually and verify details before applying.',
    );
    setGmailPreviewJobs([]);
    setGmailMessage(`Imported ${importedCount} Gmail job${importedCount === 1 ? '' : 's'}.`);
  }

  function updateStatus(id: string, status: Status): void {
    setApplications((current) =>
      current.map((application) => {
        if (application.id !== id) {
          return application;
        }

        const appliedAt = status === 'Applied' && !application.appliedAt ? todayDate() : application.appliedAt;
        const followUpAt = status === 'Applied' && !application.followUpAt ? addDays(new Date(), 7) : application.followUpAt;
        const interviewAt = status === 'Interview' && !application.interviewAt ? todayDate() : application.interviewAt;
        const notes =
          status === 'Skipped' && !application.notes.includes('Skipped:')
            ? `${application.notes}${application.notes ? '\n' : ''}Skipped: not selected from review queue.`
            : application.notes;
        return { ...application, status, appliedAt, followUpAt, interviewAt, notes };
      }),
    );
  }

  function deleteApplication(id: string): void {
    setApplications((current) => current.filter((application) => application.id !== id));

    if (selectedId === id) {
      setSelectedId(null);
    }
  }

  async function copyText(value: string): Promise<void> {
    await navigator.clipboard.writeText(value);
  }

  function resetForm(): void {
    setForm(emptyForm);
    setNotes('');
  }

  return (
    <main className="app-shell">
      <header className="top-bar">
        <div>
          <p className="eyebrow">Daily Applications</p>
          <h1>ApplyPilot</h1>
        </div>
        <div className="top-actions">
          <span className={`sync-pill ${syncStatus.toLowerCase()}`}>{syncStatusLabel(syncStatus)}</span>
          <div className="target-control" aria-label="Daily target">
            <Target size={18} />
            <span>Daily target</span>
            <input
              type="number"
              min="1"
              max="50"
              value={dailyTarget}
              onChange={(event) => setDailyTarget(Number(event.target.value))}
            />
          </div>
        </div>
      </header>

      <section className="stats-grid" aria-label="Application stats">
        <StatCard label="Saved for review" value={stats.saved} tone="blue" />
        <StatCard label="Shortlisted" value={stats.shortlisted} tone="violet" />
        <StatCard label="Ready to apply" value={stats.ready} tone="amber" />
        <StatCard label="Applied today" value={`${stats.appliedToday}/${dailyTarget}`} tone="green" />
      </section>

      <section className="analytics-panel">
        <div className="panel-heading">
          <div>
            <p className="panel-kicker">Weekly Activity</p>
            <h2>Applications and interviews</h2>
          </div>
          <BarChart3 size={22} />
        </div>

        <div className="weekly-chart" aria-label="Weekly applications and interviews">
          {weeklyStats.map((day) => (
            <div key={day.date} className="chart-day">
              <div className="chart-bars">
                <span className="chart-bar applied" style={{ height: day.appliedHeight }} title={`${day.applied} applied`} />
                <span
                  className="chart-bar interviews"
                  style={{ height: day.interviewHeight }}
                  title={`${day.interviews} interviews`}
                />
              </div>
              <strong>{formatShortDate(day.date)}</strong>
              <small>
                {day.applied}/{day.interviews}
              </small>
            </div>
          ))}
        </div>

        <div className="chart-legend">
          <span>
            <b className="legend-dot applied" />
            Applied
          </span>
          <span>
            <b className="legend-dot interviews" />
            Interviews
          </span>
        </div>
      </section>

      <section className="today-panel">
        <div className="panel-heading">
          <div>
            <p className="panel-kicker">Daily Focus</p>
            <h2>Today's plan</h2>
          </div>
          <span className="plan-count">{remainingTarget} left</span>
        </div>

        {remainingTarget === 0 ? (
          <div className="empty-state compact">Daily target complete.</div>
        ) : todayPlan.length === 0 ? (
          <div className="empty-state compact">Import or save jobs to build today's plan.</div>
        ) : (
          <div className="today-plan-list">
            {todayPlan.map((application) => (
              <article key={application.id} className="plan-card">
                <div className="plan-main">
                  <span className={`priority-dot ${application.priority.toLowerCase()}`} />
                  <div>
                    <strong>{application.title}</strong>
                    <small>
                      {application.company} - {statusLabel(application.status)} - {application.score}% fit
                    </small>
                  </div>
                </div>

                <div className="plan-actions">
                  <button type="button" className="secondary-button" onClick={() => setSelectedId(application.id)}>
                    <Search size={18} />
                    Review
                  </button>
                  {application.url && (
                    <a className="plan-link" href={application.url} target="_blank" rel="noreferrer">
                      Open
                    </a>
                  )}
                  {application.status === 'Saved' && (
                    <button type="button" className="secondary-button" onClick={() => updateStatus(application.id, 'Shortlisted')}>
                      <Star size={18} />
                      Shortlist
                    </button>
                  )}
                  {application.status === 'Shortlisted' && (
                    <button type="button" className="primary-button" onClick={() => updateStatus(application.id, 'Ready')}>
                      <Send size={18} />
                      Ready
                    </button>
                  )}
                  {application.status === 'Ready' && (
                    <button type="button" className="primary-button" onClick={() => updateStatus(application.id, 'Applied')}>
                      <CheckCircle2 size={18} />
                      Applied
                    </button>
                  )}
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      <section className="email-panel">
        <div className="panel-heading">
          <div>
            <p className="panel-kicker">LinkedIn Email Alert</p>
            <h2>Import daily jobs</h2>
          </div>
          <span className="import-count">{importableJobs.length} new</span>
        </div>

        <div className="email-import-grid">
          <label className="textarea-label email-textarea">
            <span>Paste job alert email</span>
            <textarea
              value={emailImportText}
              onChange={(event) => {
                setEmailImportText(event.target.value);
                setEmailImportMessage('');
              }}
              placeholder="Paste your LinkedIn daily job alert email here"
            />
          </label>

          <div className="import-preview">
            <div className="preview-heading">
              <strong>Detected jobs</strong>
              <small>{importedJobs.length} parsed</small>
            </div>

            {importedJobs.length === 0 ? (
              <div className="empty-state compact">Paste a LinkedIn email alert to preview jobs.</div>
            ) : (
              <div className="preview-list">
                {importedJobs.slice(0, 6).map((job) => (
                  <article key={job.url || `${job.title}-${job.company}`} className="preview-card">
                    <strong>{job.title}</strong>
                    <small>
                      {job.company} - {job.location}
                    </small>
                  </article>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="gmail-import-panel">
          <div className="gmail-controls">
            <label>
              <span>Gmail query</span>
              <input value={gmailQuery} onChange={(event) => setGmailQuery(event.target.value)} />
            </label>
            <label>
              <span>Max emails</span>
              <input
                type="number"
                min="1"
                max="50"
                value={gmailMaxResults}
                onChange={(event) => setGmailMaxResults(Number(event.target.value))}
              />
            </label>
            <button type="button" className="secondary-button" onClick={connectGmail}>
              <Mail size={18} />
              Connect Gmail
            </button>
            <button type="button" className="secondary-button" onClick={scanGmailJobs} disabled={gmailLoading}>
              <Inbox size={18} />
              {gmailLoading ? 'Scanning' : 'Scan Gmail'}
            </button>
            <button type="button" className="primary-button" onClick={importGmailPreviewJobs}>
              <Plus size={18} />
              Import preview
            </button>
          </div>

          {gmailMessage && <p className="import-message">{gmailMessage}</p>}

          {(gmailScannedMessages.length > 0 || gmailPreviewJobs.length > 0) && (
            <div className="gmail-results-grid">
              <div className="gmail-result-box">
                <div className="preview-heading">
                  <strong>Scanned emails</strong>
                  <small>{gmailScannedMessages.length} checked</small>
                </div>
                <div className="gmail-result-list">
                  {gmailScannedMessages.map((message) => (
                    <article key={message.id} className="gmail-message-row">
                      <strong>{message.subject}</strong>
                      <small>{message.from}</small>
                      <span>
                        {message.jobsFound} job{message.jobsFound === 1 ? '' : 's'}
                      </span>
                    </article>
                  ))}
                </div>
              </div>

              <div className="gmail-result-box">
                <div className="preview-heading">
                  <strong>Gmail preview</strong>
                  <small>{gmailImportableJobs.length} new</small>
                </div>
                {gmailPreviewJobs.length === 0 ? (
                  <div className="empty-state compact">No jobs found in the scanned emails.</div>
                ) : (
                  <div className="preview-list">
                    {gmailPreviewJobs.slice(0, 8).map((job) => (
                      <article key={job.url || `${job.title}-${job.company}`} className="preview-card">
                        <strong>{job.title}</strong>
                        <small>
                          {job.company} - {job.location}
                        </small>
                      </article>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        <div className="action-row">
          {emailImportMessage && <p className="import-message">{emailImportMessage}</p>}
          <button
            type="button"
            className="secondary-button"
            onClick={() => {
              setEmailImportText('');
              setEmailImportMessage('');
              setGmailMessage('');
              setGmailPreviewJobs([]);
              setGmailScannedMessages([]);
            }}
          >
            <RefreshCcw size={18} />
            Clear
          </button>
          <button type="button" className="primary-button" onClick={importEmailJobs}>
            <Plus size={18} />
            Import jobs
          </button>
        </div>
      </section>

      <section className="workspace">
        <form className="intake-panel" onSubmit={saveApplication}>
          <div className="panel-heading">
            <div>
              <p className="panel-kicker">Job Intake</p>
              <h2>Analyze role</h2>
            </div>
            <span className={`score-chip ${analysis.priority.toLowerCase()}`}>{analysis.score}% fit</span>
          </div>

          <div className="form-grid">
            <label>
              <span>Role</span>
              <input
                value={form.title}
                onChange={(event) => updateForm('title', event.target.value)}
                placeholder="Backend Engineer"
              />
            </label>
            <label>
              <span>Company</span>
              <input
                value={form.company}
                onChange={(event) => updateForm('company', event.target.value)}
                placeholder="Company name"
              />
            </label>
            <label>
              <span>Location</span>
              <input
                value={form.location}
                onChange={(event) => updateForm('location', event.target.value)}
                placeholder="Singapore"
              />
            </label>
            <label>
              <span>Job URL</span>
              <input
                value={form.url}
                onChange={(event) => updateForm('url', event.target.value)}
                placeholder="https://..."
              />
            </label>
          </div>

          <label className="textarea-label">
            <span>Job description</span>
            <textarea
              value={form.description}
              onChange={(event) => updateForm('description', event.target.value)}
              placeholder="Paste the job post here"
            />
          </label>

          <div className="check-row">
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={form.sponsorship}
                onChange={(event) => updateForm('sponsorship', event.target.checked)}
              />
              <span>EP sponsorship mentioned</span>
            </label>
          </div>

          <div className="match-row">
            <KeywordList title="Matched" keywords={analysis.matchedKeywords} empty="No matches yet" />
            <KeywordList title="Gaps" keywords={analysis.missingKeywords} empty="No gaps yet" />
          </div>

          <label className="textarea-label compact">
            <span>Profile source</span>
            <textarea value={profile} onChange={(event) => setProfile(event.target.value)} />
          </label>

          <div className="profile-version-panel">
            <div className="profile-version-actions">
              <input
                value={profileName}
                onChange={(event) => setProfileName(event.target.value)}
                placeholder="Profile version name"
              />
              <label className="upload-button">
                <Upload size={18} />
                Resume PDF/TXT/MD
                <input
                  type="file"
                  accept=".pdf,.txt,.md,.markdown,application/pdf,text/plain,text/markdown"
                  onChange={(event) => handleResumeUpload(event.target.files?.[0])}
                />
              </label>
              <button type="button" className="secondary-button" onClick={() => saveProfileVersion()}>
                <Save size={18} />
                Save profile
              </button>
            </div>

            {profileVersionMessage && <p className="import-message">{profileVersionMessage}</p>}

            {profileVersions.length > 0 && (
              <div className="profile-version-list">
                {profileVersions.slice(0, 4).map((version) => (
                  <button
                    key={version.id}
                    type="button"
                    className={`profile-version-row ${activeProfileId === version.id ? 'active' : ''}`}
                    onClick={() => activateProfileVersion(version.id)}
                  >
                    <strong>{version.name}</strong>
                    <small>
                      {version.source} - {new Date(version.createdAt).toLocaleDateString('en-SG')}
                    </small>
                  </button>
                ))}
              </div>
            )}
          </div>

          <label className="textarea-label compact">
            <span>Notes</span>
            <textarea value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Salary, pass, recruiter, fit" />
          </label>

          <div className="action-row">
            <button type="button" className="secondary-button" onClick={resetForm}>
              <RefreshCcw size={18} />
              Reset
            </button>
            <button type="submit" className="primary-button">
              <Save size={18} />
              Save role
            </button>
          </div>
        </form>

        <section className="draft-panel">
          <div className="panel-heading">
            <div>
              <p className="panel-kicker">Tailoring</p>
              <h2>Application draft</h2>
            </div>
            <button type="button" className="secondary-button" onClick={generateAiDraft} disabled={aiLoading}>
              <Sparkles size={18} />
              {aiLoading ? 'Generating' : 'AI draft'}
            </button>
          </div>

          {aiError && <p className="ai-message error">{aiError}</p>}
          {aiDraft && <p className="ai-message success">AI draft generated. Review before applying.</p>}
          {aiDraft?.fitNotes && aiDraft.fitNotes.length > 0 && (
            <div className="fit-notes">
              <strong>Fit notes</strong>
              <ul>
                {aiDraft.fitNotes.map((note) => (
                  <li key={note}>{note}</li>
                ))}
              </ul>
            </div>
          )}

          <DraftBlock
            icon={<FileText size={18} />}
            title="Resume bullets"
            content={activeDraft.resumeBullets.map((bullet) => `- ${bullet}`).join('\n')}
            onCopy={() => copyText(activeDraft.resumeBullets.map((bullet) => `- ${bullet}`).join('\n'))}
          />
          <DraftBlock
            icon={<Mail size={18} />}
            title="Cover letter"
            content={activeDraft.coverLetter}
            onCopy={() => copyText(activeDraft.coverLetter)}
          />
          <DraftBlock
            icon={<BriefcaseBusiness size={18} />}
            title="Recruiter message"
            content={activeDraft.recruiterMessage}
            onCopy={() => copyText(activeDraft.recruiterMessage)}
          />
        </section>
      </section>

      <section className="tracker-panel">
        <div className="tracker-toolbar">
          <div>
            <p className="panel-kicker">Pipeline</p>
            <h2>Application tracker</h2>
          </div>
          <div className="toolbar-controls">
            <label className="search-box">
              <Search size={18} />
              <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search applications" />
            </label>
            <label className="select-box">
              <ListFilter size={18} />
              <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as Status | 'All')}>
                <option value="All">All</option>
                {statuses.map((status) => (
                  <option key={status} value={status}>
                    {statusLabel(status)}
                  </option>
                ))}
              </select>
            </label>
            <button type="button" className="secondary-button" onClick={() => downloadCsv(applications)}>
              <Download size={18} />
              CSV
            </button>
          </div>
        </div>

        <div className="tracker-grid">
          <div className="application-list">
            {filteredApplications.length === 0 ? (
              <div className="empty-state">No applications yet.</div>
            ) : (
              filteredApplications.map((application) => (
                <button
                  key={application.id}
                  type="button"
                  className={`application-row ${selectedApplication?.id === application.id ? 'selected' : ''}`}
                  onClick={() => setSelectedId(application.id)}
                >
                  <span className={`priority-dot ${application.priority.toLowerCase()}`} />
                  <span className="application-main">
                    <strong>{application.title}</strong>
                    <small>{application.company}</small>
                  </span>
                  <span className="application-meta">
                    <strong>{application.score}%</strong>
                    <small>{statusLabel(application.status)}</small>
                  </span>
                </button>
              ))
            )}
          </div>

          <div className="application-detail">
            {selectedApplication ? (
              <>
                <div className="detail-heading">
                  <div>
                    <p className="panel-kicker">{selectedApplication.company}</p>
                    <h3>{selectedApplication.title}</h3>
                  </div>
                  <span className={`score-chip ${selectedApplication.priority.toLowerCase()}`}>
                    {selectedApplication.score}% fit
                  </span>
                </div>

                <div className="detail-controls">
                  <select
                    value={selectedApplication.status}
                    onChange={(event) => updateStatus(selectedApplication.id, event.target.value as Status)}
                  >
                    {statuses.map((status) => (
                      <option key={status} value={status}>
                        {statusLabel(status)}
                      </option>
                    ))}
                  </select>
                  {selectedApplication.status === 'Saved' && (
                    <>
                      <button
                        type="button"
                        className="secondary-button"
                        onClick={() => updateStatus(selectedApplication.id, 'Shortlisted')}
                      >
                        <Star size={18} />
                        Shortlist
                      </button>
                      <button
                        type="button"
                        className="ghost-danger-button"
                        onClick={() => updateStatus(selectedApplication.id, 'Skipped')}
                      >
                        <XCircle size={18} />
                        Skip
                      </button>
                    </>
                  )}
                  {selectedApplication.status === 'Shortlisted' && (
                    <>
                      <button
                        type="button"
                        className="primary-button"
                        onClick={() => updateStatus(selectedApplication.id, 'Ready')}
                      >
                        <Send size={18} />
                        Ready
                      </button>
                      <button
                        type="button"
                        className="ghost-danger-button"
                        onClick={() => updateStatus(selectedApplication.id, 'Skipped')}
                      >
                        <XCircle size={18} />
                        Skip
                      </button>
                    </>
                  )}
                  {selectedApplication.status === 'Ready' && (
                    <>
                      <button
                        type="button"
                        className="secondary-button"
                        onClick={() => updateStatus(selectedApplication.id, 'Applied')}
                      >
                        <CheckCircle2 size={18} />
                        Applied
                      </button>
                      <button
                        type="button"
                        className="ghost-danger-button"
                        onClick={() => updateStatus(selectedApplication.id, 'Skipped')}
                      >
                        <XCircle size={18} />
                        Skip
                      </button>
                    </>
                  )}
                  <button type="button" className="danger-button" onClick={() => deleteApplication(selectedApplication.id)}>
                    <Trash2 size={18} />
                    Delete
                  </button>
                </div>

                <div className="queue-stepper" aria-label="Review queue progress">
                  {(['Saved', 'Shortlisted', 'Ready', 'Applied'] as Status[]).map((status) => (
                    <span
                      key={status}
                      className={selectedApplication.status === status ? 'active' : ''}
                    >
                      {statusLabel(status)}
                    </span>
                  ))}
                </div>

                <dl className="detail-list">
                  <div>
                    <dt>Location</dt>
                    <dd>{selectedApplication.location}</dd>
                  </div>
                  <div>
                    <dt>Follow-up</dt>
                    <dd>{selectedApplication.followUpAt ?? 'Not set'}</dd>
                  </div>
                  <div>
                    <dt>Sponsorship</dt>
                    <dd>{selectedApplication.sponsorship ? 'Mentioned' : 'Not mentioned'}</dd>
                  </div>
                </dl>

                <KeywordList title="Matched skills" keywords={selectedApplication.matchedKeywords} empty="No matches" />

                <DraftBlock
                  icon={<Clipboard size={18} />}
                  title="Saved cover letter"
                  content={selectedApplication.coverLetter}
                  onCopy={() => copyText(selectedApplication.coverLetter)}
                />

                {selectedApplication.url && (
                  <a className="job-link" href={selectedApplication.url} target="_blank" rel="noreferrer">
                    Open job post
                  </a>
                )}
              </>
            ) : (
              <div className="empty-state">Select an application.</div>
            )}
          </div>
        </div>
      </section>
    </main>
  );
}

function StatCard({
  label,
  value,
  tone,
}: {
  label: string;
  value: string | number;
  tone: 'green' | 'blue' | 'violet' | 'amber';
}) {
  return (
    <article className={`stat-card ${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </article>
  );
}

function KeywordList({ title, keywords, empty }: { title: string; keywords: string[]; empty: string }) {
  return (
    <div className="keyword-box">
      <span>{title}</span>
      <div className="keyword-list">
        {keywords.length === 0 ? (
          <small>{empty}</small>
        ) : (
          keywords.map((keyword) => <b key={keyword}>{keyword}</b>)
        )}
      </div>
    </div>
  );
}

function DraftBlock({
  icon,
  title,
  content,
  onCopy,
}: {
  icon: ReactNode;
  title: string;
  content: string;
  onCopy: () => void;
}) {
  return (
    <article className="draft-block">
      <header>
        <span>
          {icon}
          {title}
        </span>
        <button type="button" onClick={onCopy} aria-label={`Copy ${title}`}>
          <Clipboard size={16} />
        </button>
      </header>
      <pre>{content}</pre>
    </article>
  );
}

export default App;
