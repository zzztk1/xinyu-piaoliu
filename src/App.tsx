import { useCallback, useEffect, useRef, useState } from 'react'
import type { FormEvent, MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from 'react'
import {
  Archive,
  ChevronLeft,
  ChevronDown,
  Compass,
  Flag,
  LockKeyhole,
  Moon,
  Radio,
  RotateCcw,
  ShieldCheck,
  UserPlus,
  UserRound,
  Waves,
} from 'lucide-react'
import './App.css'

type Dimensions = {
  calm: number
  energy: number
  social: number
  stress: number
  openness: number
  clarity: number
}

type Analysis = {
  id: string
  primaryEmotion: string
  label: string
  intensity: number
  valence: number
  arousal: number
  dimensions: Dimensions
  keywords: string[]
  matchStyle: string
  supportNeed: string
  rationale: string
  safetyFlag: string
  dimensionChanges?: Partial<Dimensions>
  tuningSummary?: string
  matchHints?: string[]
  emotionTheme?: EmotionTheme
}

type EmotionTheme = {
  key: 'excited' | 'sad' | 'anxious' | 'tired' | 'angry' | 'lonely' | 'mixed' | 'neutral'
  label: string
  atmosphere: string
  accent: string
  motion: string
}

type AccountProfile = {
  mbti: string
  zodiac: string
  selfIntro: string
  boundary: string
  publicFields: {
    mbti: boolean
    zodiac: boolean
    selfIntro: boolean
    boundary: boolean
  }
}

type Account = {
  id: string
  cabinName: string
  profile?: AccountProfile
  avatarTheme?: string
  updatedAt?: number
  createdAt: number
  lastSeenAt: number
}

type User = {
  id: string
  alias: string
  avatar: string
  avatarTone: string
  role: string
  selfIntro?: string
  profile?: Partial<AccountProfile>
  analysis: Analysis
  accountId?: string
  entryId?: string
  signalStrength?: number
  roomId?: string | null
}

type EmotionEntry = {
  id: string
  rawText: string
  analysis: Analysis
  moodChips: Record<string, string[]>
  intakeAnswers: Record<string, string>
  signalStrength: number
  createdAt: number
}

type FollowUpQuestion = {
  id: string
  dimension: string
  prompt: string
  options: FollowUpOption[]
}

type FollowUpOption = string | {
  label: string
  hint?: string
}

type Room = {
  id: string
  viewerId: string
  partner: User
  participantIds: string[]
  status?: string
  partnerStatus?: 'online' | 'left'
  lastActivityAt?: number
  matchBasis: {
    mode: string
    reason: string
    sharedFrequency: number
    signalStrength: number
    safetyBoundary: string
    contrastDimensions: Array<{ key: keyof Dimensions; gap: number }>
    topicSuggestions: string[]
  }
}

type ChatMessage = {
  id: string
  roomId: string
  senderId?: string
  senderAlias: string
  senderType?: string
  text: string
  createdAt: number
  mine: boolean
}

type EchoCard = {
  id: string
  roomId: string
  snapshot: {
    rawSignal?: string
    moodLabel?: string
    sharedFrequency?: number
    partnerAlias?: string
    partnerEcho?: string
    messages?: Array<{
      id: string
      senderType: string
      senderId?: string
      senderAlias: string
      text: string
      createdAt: number
    }>
    matchReason?: string
    signalTags?: string[]
    createdAt?: number
  }
  createdAt: number
}

type ApiError = {
  ok: false
  errorType: string
  message: string
}

const STORAGE_KEY = 'xinyu-piaoliu.account'
const CABIN_LIST_KEY = 'xinyu-piaoliu.accounts'
const LEGACY_STORAGE_KEY = 'vibechat.account'
const LEGACY_CABIN_LIST_KEY = 'vibechat.accounts'
const cabinNameSeeds = ['夜航员', '雾灯来客', '听潮者', '月白停靠', '星港旅人', '晴野小舟', '雨港来信', '远灯守夜']
const cabinNameTails = ['临岸', '微光', '潮声', '半醒', '北窗', '朝汐', '慢港', '浅湾']

const dimensionLabels: Record<keyof Dimensions, string> = {
  calm: '平静',
  energy: '能量',
  social: '社交',
  stress: '压力',
  openness: '开放',
  clarity: '清晰',
}

const scanLines = ['正在避开太亮的港口', '正在寻找能短暂停靠的频率', '有一束回声靠近']

const defaultProfile: AccountProfile = {
  mbti: '',
  zodiac: '',
  selfIntro: '',
  boundary: '不交换联系方式，不聊太深的隐私。',
  publicFields: {
    mbti: false,
    zodiac: false,
    selfIntro: true,
    boundary: true,
  },
}

function readJsonStorage<T>(key: string, fallback: T): T {
  try {
    const value = window.localStorage.getItem(key)
    return value ? JSON.parse(value) as T : fallback
  } catch {
    return fallback
  }
}

function readJsonStorageWithLegacy<T>(key: string, legacyKey: string, fallback: T): T {
  const current = readJsonStorage<T>(key, fallback)
  if (current !== fallback) return current
  return readJsonStorage<T>(legacyKey, fallback)
}

function normalizeAccount(account: Account): Account {
  return { ...account, profile: { ...defaultProfile, ...(account.profile || {}), publicFields: { ...defaultProfile.publicFields, ...(account.profile?.publicFields || {}) } } }
}

function mergeAccountList(current: Account[], next: Account) {
  const normalized = normalizeAccount(next)
  const byId = new Map(current.map((item) => [item.id, normalizeAccount(item)]))
  byId.set(normalized.id, normalized)
  return [...byId.values()]
}

function randomCabinName() {
  const seed = cabinNameSeeds[Math.floor(Math.random() * cabinNameSeeds.length)]
  const tail = cabinNameTails[Math.floor(Math.random() * cabinNameTails.length)]
  return `${seed}${tail}`
}

function randomPasscode() {
  return String(Math.floor(1000 + Math.random() * 9000))
}

function checkLocalSafetyText(text: string) {
  if (/(微信|vx|v信|qq|手机号|电话|联系方式|见面|线下|开房|裸聊|黄色|自杀|轻生|伤害自己|不想活)/i.test(text)) {
    return '这句话可能越过安全边界，先换一种更安全的说法。'
  }
  return ''
}

function App() {
  const [account, setAccount] = useState<Account | null>(() => {
    const saved = readJsonStorageWithLegacy<Account | null>(STORAGE_KEY, LEGACY_STORAGE_KEY, null)
    return saved ? normalizeAccount(saved) : null
  })
  const [knownAccounts, setKnownAccounts] = useState<Account[]>(() => {
    const list = readJsonStorageWithLegacy<Account[]>(CABIN_LIST_KEY, LEGACY_CABIN_LIST_KEY, []).map(normalizeAccount)
    const active = readJsonStorageWithLegacy<Account | null>(STORAGE_KEY, LEGACY_STORAGE_KEY, null)
    return active ? mergeAccountList(list, active) : list
  })
  const [authMode, setAuthMode] = useState<'register' | 'login'>('register')
  const [cabinName, setCabinName] = useState(() => randomCabinName())
  const [passcode, setPasscode] = useState(() => randomPasscode())
  const [authProfile, setAuthProfile] = useState<AccountProfile>(() => ({ ...defaultProfile, publicFields: { ...defaultProfile.publicFields } }))
  const [text, setText] = useState('我此刻有点焦虑，想找一个陌生人慢慢聊，不想把压力带给熟人。')
  const [entry, setEntry] = useState<EmotionEntry | null>(null)
  const [user, setUser] = useState<User | null>(null)
  const [analysis, setAnalysis] = useState<Analysis | null>(null)
  const [followUps, setFollowUps] = useState<FollowUpQuestion[]>([])
  const [nextQuestion, setNextQuestion] = useState<FollowUpQuestion | null>(null)
  const [answers, setAnswers] = useState<Record<string, string>>({})
  const [driftIdentity, setDriftIdentity] = useState<{ alias: string; title: string; cabinSignal: string } | null>(null)
  const [signalTags, setSignalTags] = useState<string[]>([])
  const [signalStrength, setSignalStrength] = useState(35)
  const [emotionTheme, setEmotionTheme] = useState<EmotionTheme | null>(null)
  const [safetyBoundary, setSafetyBoundary] = useState('保持匿名距离，不交换隐私；任何时候都可以离开或举报。')
  const [room, setRoom] = useState<Room | null>(null)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [partnerTyping, setPartnerTyping] = useState(false)
  const [partnerStatus, setPartnerStatus] = useState<'online' | 'left'>('online')
  const [lastActivityAt, setLastActivityAt] = useState<number | null>(null)
  const [messageText, setMessageText] = useState('')
  const [echoCard, setEchoCard] = useState<EchoCard | null>(null)
  const [echoCards, setEchoCards] = useState<EchoCard[]>([])
  const [emotionTrail, setEmotionTrail] = useState<EmotionEntry[]>([])
  const [view, setView] = useState<'drift' | 'echo' | 'profile'>('drift')
  const [phase, setPhase] = useState<'home' | 'tuning' | 'coordinate' | 'scanning' | 'matchedPreview' | 'chat' | 'settling' | 'echo'>('home')
  const [scanStep, setScanStep] = useState(0)
  const [loading, setLoading] = useState<'auth' | 'analyze' | 'intake' | 'match' | 'send' | 'echo' | 'profile' | 'leave' | null>(null)
  const [notice, setNotice] = useState('')
  const messageListRef = useRef<HTMLDivElement | null>(null)

  const answeredCount = Object.values(answers).filter(Boolean).length
  const sortedMessages = [...messages].sort((a, b) => Number(a.createdAt || 0) - Number(b.createdAt || 0))

  const rememberAccount = useCallback((nextAccount: Account) => {
    const normalized = normalizeAccount(nextAccount)
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(normalized))
    setAccount(normalized)
    setKnownAccounts((current) => {
      const next = mergeAccountList(current, normalized)
      window.localStorage.setItem(CABIN_LIST_KEY, JSON.stringify(next))
      return next
    })
  }, [])

  const refreshArchive = useCallback(async (accountId: string) => {
    try {
      const result = await api<{ account?: Account; echoCards: EchoCard[]; emotionTrail: EmotionEntry[] }>(`/api/me?accountId=${accountId}`)
      if (result.ok) {
        if (result.account) rememberAccount(result.account)
        setEchoCards(result.echoCards)
        setEmotionTrail(result.emotionTrail)
      } else if (result.errorType === 'account_not_found') {
        window.localStorage.removeItem(STORAGE_KEY)
        setAccount(null)
        setKnownAccounts((current) => {
          const next = current.filter((item) => item.id !== accountId)
          window.localStorage.setItem(CABIN_LIST_KEY, JSON.stringify(next))
          return next
        })
        setEchoCards([])
        setEmotionTrail([])
      }
    } catch {
      // Archive refresh is non-blocking; keep the current encounter visible if the network blips.
    }
  }, [rememberAccount])

  useEffect(() => {
    if (!account?.id) return
    const timer = window.setTimeout(() => { void refreshArchive(account.id) }, 0)
    return () => window.clearTimeout(timer)
  }, [account?.id, refreshArchive])

  const refreshMessages = useCallback(async (roomId: string, viewerId: string) => {
    try {
      const result = await api<{ messages: ChatMessage[]; typing: boolean; partnerStatus?: 'online' | 'left'; lastActivityAt?: number }>(`/api/messages?roomId=${roomId}&viewerId=${viewerId}`)
      if (result.ok) {
        setMessages(result.messages)
        setPartnerTyping(result.typing)
        setPartnerStatus(result.partnerStatus || 'online')
        setLastActivityAt(result.lastActivityAt || null)
      }
    } catch {
      setPartnerTyping(false)
    }
  }, [])

  useEffect(() => {
    if (!room || !user) return
    const initial = window.setTimeout(() => refreshMessages(room.id, user.id), 0)
    const timer = window.setInterval(() => refreshMessages(room.id, user.id), 1600)
    return () => {
      window.clearTimeout(initial)
      window.clearInterval(timer)
    }
  }, [room, user, refreshMessages])

  useEffect(() => {
    if (phase !== 'scanning') return
    const timer = window.setInterval(() => {
      setScanStep((current) => Math.min(2, current + 1))
    }, 1100)
    return () => window.clearInterval(timer)
  }, [phase])

  useEffect(() => {
    const node = messageListRef.current
    if (!node) return
    node.scrollTo({ top: node.scrollHeight, behavior: 'smooth' })
  }, [sortedMessages.length, partnerTyping, partnerStatus])

  async function authenticate(profileOverride = authProfile) {
    setLoading('auth')
    setNotice('')
    try {
      const result = await api<{ account: Account }>(authMode === 'register' ? '/api/auth/register' : '/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ cabinName, passcode, profile: authMode === 'register' ? profileOverride : undefined }),
      })
      if (!result.ok) throw new Error(result.message)
      rememberAccount(result.account)
      await refreshArchive(result.account.id)
    } catch (error) {
      if (authMode === 'register' && error instanceof Error && error.message.includes('已经被使用')) {
        setAuthMode('login')
      }
      setNotice(error instanceof Error ? error.message : '舱门暂时没有亮起，请稍后再试。')
    } finally {
      setLoading(null)
    }
  }

  async function submitAuth(event: FormEvent) {
    event.preventDefault()
    await authenticate()
  }

  async function skipProfileAndStart() {
    const skippedProfile = { ...defaultProfile, publicFields: { ...defaultProfile.publicFields } }
    setAuthProfile(skippedProfile)
    await authenticate(skippedProfile)
  }

  function randomizeCabinIdentity() {
    setCabinName(randomCabinName())
    setPasscode(randomPasscode())
  }

  async function createCabin(nextName: string, nextPasscode: string) {
    setLoading('auth')
    setNotice('')
    try {
      const result = await api<{ account: Account }>('/api/auth/register', {
        method: 'POST',
        body: JSON.stringify({ cabinName: nextName, passcode: nextPasscode }),
      })
      if (!result.ok) throw new Error(result.message)
      rememberAccount(result.account)
      resetDrift()
      setView('profile')
      await refreshArchive(result.account.id)
      setNotice('新的舱灯已经点亮，当前正在使用这个舱号。')
    } catch (error) {
      setNotice(error instanceof Error ? error.message : '新的舱灯没有点亮，请换一个舱号。')
    } finally {
      setLoading(null)
    }
  }

  async function switchAccount(nextAccount: Account) {
    rememberAccount(nextAccount)
    resetDrift()
    await refreshArchive(nextAccount.id)
    setNotice(`已切换到 ${nextAccount.cabinName}`)
  }

  async function saveProfile(profile: AccountProfile) {
    if (!account) return
    setLoading('profile')
    setNotice('')
    try {
      const result = await api<{ account: Account; echoCards: EchoCard[]; emotionTrail: EmotionEntry[] }>('/api/profile', {
        method: 'PATCH',
        body: JSON.stringify({ accountId: account.id, profile }),
      })
      if (!result.ok) throw new Error(result.message)
      rememberAccount(result.account)
      setEchoCards(result.echoCards)
      setEmotionTrail(result.emotionTrail)
      setNotice('舱号资料已更新。')
    } catch (error) {
      setNotice(error instanceof Error ? error.message : '资料没有保存成功，请再试一次。')
    } finally {
      setLoading(null)
    }
  }

  async function analyze(event: FormEvent) {
    event.preventDefault()
    if (!account) return
    setLoading('analyze')
    setNotice('')
    setRoom(null)
    setMessages([])
    setEchoCard(null)
    try {
      const result = await api<{
        user: User
        analysis: Analysis
        entry: EmotionEntry
        driftIdentity: { alias: string; title: string; cabinSignal: string }
        signalTags: string[]
        followUpQuestions: FollowUpQuestion[]
        nextQuestion: FollowUpQuestion | null
        clarityScore: number
        emotionTheme: EmotionTheme
        safetyBoundary: string
      }>('/api/analyze', {
        method: 'POST',
        body: JSON.stringify({ accountId: account.id, text }),
      })
      if (!result.ok) throw new Error(result.message)
      setUser(result.user)
      setAnalysis(result.analysis)
      setEntry(result.entry)
      setDriftIdentity(result.driftIdentity)
      setSignalTags(result.signalTags)
      setFollowUps(result.followUpQuestions)
      setNextQuestion(result.nextQuestion)
      setEmotionTheme(result.emotionTheme)
      setSafetyBoundary(result.safetyBoundary)
      setSignalStrength(result.clarityScore ?? result.entry.signalStrength)
      setAnswers({})
      setPhase('tuning')
    } catch (error) {
      setNotice(error instanceof Error ? error.message : '今晚的信号没有放出去，请再试一次。')
    } finally {
      setLoading(null)
    }
  }

  async function chooseAnswer(id: string, value: string) {
    if (!entry) return
    setLoading('intake')
    setNotice('')
    try {
      const result = await api<{
        entry: EmotionEntry
        analysis: Analysis
        user?: User
        signalStrength: number
        clarityScore: number
        signalTags: string[]
        safetyBoundary: string
        nextQuestion: FollowUpQuestion | null
        followUpQuestions: FollowUpQuestion[]
        questionHistory: Record<string, string>
        readyToMatch: boolean
        emotionTheme: EmotionTheme
        dimensionChanges?: Partial<Dimensions>
        tuningSummary?: string
        matchHints?: string[]
      }>('/api/intake/answer', {
        method: 'POST',
        body: JSON.stringify({ entryId: entry.id, userId: user?.id, questionId: id, answer: value }),
      })
      if (!result.ok) throw new Error(result.message)
      setEntry(result.entry)
      setAnalysis(result.analysis)
      if (result.user) setUser(result.user)
      setSignalStrength(result.clarityScore ?? result.signalStrength)
      setSignalTags(result.signalTags)
      setFollowUps(result.followUpQuestions)
      setNextQuestion(result.nextQuestion)
      setAnswers(result.questionHistory)
      setEmotionTheme(result.emotionTheme)
      setSafetyBoundary(result.safetyBoundary)
      if (result.readyToMatch) {
        setPhase('coordinate')
      }
    } catch (error) {
      setNotice(error instanceof Error ? error.message : '调频被海雾打断，请再试一次。')
    } finally {
      setLoading(null)
    }
  }

  async function startMatch(matchUser = user || undefined, matchEntry = entry || undefined) {
    if (!matchUser || !matchEntry) return
    setLoading('match')
    setNotice('')
    setScanStep(0)
    setPhase('scanning')
    try {
      const result = await api<{ status: string; room?: Room }>('/api/match/request', {
        method: 'POST',
        body: JSON.stringify({ userId: matchUser.id, entryId: matchEntry.id }),
      })
      if (!result.ok) throw new Error(result.message)
      if (result.room) {
        await sleep(2400)
        setRoom(result.room)
        setPartnerStatus(result.room.partnerStatus || 'online')
        setLastActivityAt(result.room.lastActivityAt || Date.now())
        setPhase('matchedPreview')
        return
      }
      const startedAt = Date.now()
      while (Date.now() - startedAt < 8200) {
        await sleep(700)
        const status = await api<{ status: string; room?: Room }>(`/api/match/status?userId=${encodeURIComponent(matchUser.id)}`)
        if (!status.ok) throw new Error(status.message)
        if (status.room) {
          await sleep(500)
          setRoom(status.room)
          setPartnerStatus(status.room.partnerStatus || 'online')
          setLastActivityAt(status.room.lastActivityAt || Date.now())
          setPhase('matchedPreview')
          return
        }
      }
      throw new Error('这束频率暂时没有靠岸，请再试一次。')
    } catch (error) {
      setNotice(error instanceof Error ? error.message : '频率扫描中断，请稍后再试。')
      setPhase('coordinate')
    } finally {
      setLoading(null)
    }
  }

  async function quickRematch() {
    if (!user || !entry) return
    setLoading('match')
    setNotice('')
    setMessages([])
    setRoom(null)
    setScanStep(0)
    setPhase('scanning')
    try {
      await sleep(1200)
      const result = await api<{ status: string; room?: Room }>('/api/match/rematch', {
        method: 'POST',
        body: JSON.stringify({ userId: user.id, entryId: entry.id }),
      })
      if (!result.ok) throw new Error(result.message)
      if (result.room) {
        setRoom(result.room)
        setPartnerStatus(result.room.partnerStatus || 'online')
        setLastActivityAt(result.room.lastActivityAt || Date.now())
        setPhase('matchedPreview')
        return
      }
      const startedAt = Date.now()
      while (Date.now() - startedAt < 8200) {
        await sleep(700)
        const status = await api<{ status: string; room?: Room }>(`/api/match/status?userId=${encodeURIComponent(user.id)}`)
        if (!status.ok) throw new Error(status.message)
        if (status.room) {
          setRoom(status.room)
          setPartnerStatus(status.room.partnerStatus || 'online')
          setLastActivityAt(status.room.lastActivityAt || Date.now())
          setPhase('matchedPreview')
          return
        }
      }
      throw new Error('这束频率暂时没有靠岸，请再试一次。')
    } catch (error) {
      setNotice(error instanceof Error ? error.message : '重新漂流中断，请稍后再试。')
      setPhase('chat')
    } finally {
      setLoading(null)
    }
  }

  async function sendMessage(value: string) {
    if (!room || !user || !value.trim()) return
    const safetyReason = checkLocalSafetyText(value)
    if (safetyReason) {
      setNotice(safetyReason)
      return
    }
    setLoading('send')
    try {
      const result = await api<{ message: ChatMessage }>('/api/messages', {
        method: 'POST',
        body: JSON.stringify({ roomId: room.id, senderId: user.id, text: value }),
      })
      if (!result.ok) throw new Error(result.message)
      setMessages((current) => mergeMessages(current, [{ ...result.message, mine: true }]))
      setLastActivityAt(result.message.createdAt || Date.now())
      setMessageText('')
      setPartnerTyping(true)
      await refreshMessages(room.id, user.id)
    } catch (error) {
      setNotice(error instanceof Error ? error.message : '这句回声没有放出去。')
    } finally {
      setLoading(null)
    }
  }

  async function saveEchoCard() {
    if (loading === 'echo') return
    if (!account || !room || !entry || !user) {
      setNotice('回声瓶没有收好，请回到聊天里再试一次。')
      return
    }
    setLoading('echo')
    try {
      const result = await api<{ echoCard: EchoCard; echoCards: EchoCard[]; emotionTrail: EmotionEntry[] }>('/api/echo-card', {
        method: 'POST',
        body: JSON.stringify({ accountId: account.id, roomId: room.id, entryId: entry.id, viewerId: user.id }),
      })
      if (!result.ok) throw new Error(result.message)
      setEchoCard(result.echoCard)
      setEchoCards(result.echoCards)
      setEmotionTrail(result.emotionTrail)
      setPhase('echo')
    } catch (error) {
      setNotice(error instanceof Error ? error.message : '回声卡没有收好，请再试一次。')
    } finally {
      setLoading(null)
    }
  }

  async function leaveCurrentRoom() {
    if (!room || !user) {
      resetDrift()
      setView('drift')
      return
    }
    setLoading('leave')
    setNotice('')
    try {
      const result = await api<{ roomStatus: string; partnerStatus: 'online' | 'left'; lastActivityAt: number }>('/api/rooms/leave', {
        method: 'POST',
        body: JSON.stringify({ roomId: room.id, viewerId: user.id }),
      })
      if (!result.ok) throw new Error(result.message)
      resetDrift()
      setView('drift')
      setNotice('已经暂时离开这次停靠。')
    } catch (error) {
      setNotice(error instanceof Error ? error.message : '暂时离开失败，请再试一次。')
    } finally {
      setLoading(null)
    }
  }

  async function reportRoom(reason: string) {
    if (!account || !room) return
    const result = await api<{ message: string }>('/api/report', {
      method: 'POST',
      body: JSON.stringify({ accountId: account.id, roomId: room.id, reason }),
    })
    setNotice(result.ok ? result.message : result.message)
  }

  function resetDrift() {
    setPhase('home')
    setEntry(null)
    setUser(null)
    setAnalysis(null)
    setEmotionTheme(null)
    setSignalStrength(35)
    setSignalTags([])
    setFollowUps([])
    setAnswers({})
    setRoom(null)
    setMessages([])
    setPartnerTyping(false)
    setPartnerStatus('online')
    setLastActivityAt(null)
    setEchoCard(null)
    setNotice('')
  }

  const activeEcho = echoCard || echoCards[0] || null
  const activeThemeKey = emotionTheme?.key || analysis?.emotionTheme?.key || 'neutral'

  return (
    <main className={`app-shell phase-${phase} theme-${activeThemeKey}`}>
      <EmotionWorldScene phase={phase} strength={signalStrength} themeKey={activeThemeKey} />
      <section className="drift-app" aria-label="心屿漂流">
        <HeaderBar account={account} view={view} setView={setView} />

        {!account ? (
          <CabinGate
            authMode={authMode}
            cabinName={cabinName}
            passcode={passcode}
            profile={authProfile}
            loading={loading === 'auth'}
            onAuthMode={setAuthMode}
            onCabinName={setCabinName}
            onPasscode={setPasscode}
            onProfile={setAuthProfile}
            onRandomize={randomizeCabinIdentity}
            onSkipProfile={skipProfileAndStart}
            onSubmit={submitAuth}
          />
        ) : view === 'echo' ? (
          <EchoArchive echoCards={echoCards} emotionTrail={emotionTrail} onBack={() => setView('drift')} />
        ) : view === 'profile' ? (
          <ProfileView
            key={account.id}
            account={account}
            accounts={knownAccounts}
            echoCards={echoCards}
            loading={loading}
            onSwitch={switchAccount}
            onCreate={createCabin}
            onSaveProfile={saveProfile}
            onDrift={() => { resetDrift(); setView('drift') }}
          />
        ) : (
          <section className="flow-stage" data-testid="home-stage">
            {phase === 'home' && (
              <SignalComposer
                text={text}
                loading={loading === 'analyze'}
                onText={setText}
                onSubmit={analyze}
              />
            )}

            {phase === 'tuning' && analysis && (
              <TuningRitual
                analysis={analysis}
                followUps={followUps}
                nextQuestion={nextQuestion}
                answers={answers}
                answeredCount={answeredCount}
                signalStrength={signalStrength}
                loading={loading === 'intake'}
                onAnswer={chooseAnswer}
              />
            )}

            {phase === 'coordinate' && analysis && (
              <CoordinateDock
                analysis={analysis}
                driftIdentity={driftIdentity}
                signalTags={signalTags}
                signalStrength={signalStrength}
                safetyBoundary={safetyBoundary}
                loading={loading === 'match'}
                onScan={() => startMatch()}
              />
            )}

            {phase === 'scanning' && (
              <RadarEncounter signalStrength={signalStrength} scanStep={scanStep} />
            )}

            {phase === 'matchedPreview' && room && user && (
              <MatchPreview
                room={room}
                user={user}
                onEnter={() => setPhase('chat')}
                onBack={() => setPhase('coordinate')}
              />
            )}

            {phase === 'chat' && room && user && (
              <EncounterChat
                room={room}
                user={user}
                sortedMessages={sortedMessages}
                messageText={messageText}
                partnerTyping={partnerTyping}
                partnerStatus={partnerStatus}
                lastActivityAt={lastActivityAt}
                loading={loading}
                messageListRef={messageListRef}
                onMessageText={setMessageText}
                onSend={sendMessage}
                onReport={reportRoom}
                onBack={() => setPhase('matchedPreview')}
                onRematch={quickRematch}
                onSettle={() => setPhase('settling')}
                onLeave={leaveCurrentRoom}
              />
            )}

            {phase === 'settling' && room && (
              <EchoRitual room={room} loading={loading === 'echo'} onCollect={saveEchoCard} onBack={() => setPhase('chat')} />
            )}

            {phase === 'echo' && activeEcho && (
              <EchoCardView card={activeEcho} trail={emotionTrail} onRematch={resetDrift} />
            )}
          </section>
        )}

        {notice && <p className="notice-banner" data-testid="notice-banner">{notice}</p>}
      </section>
    </main>
  )
}

function HeaderBar({ account, view, setView }: { account: Account | null; view: 'drift' | 'echo' | 'profile'; setView: (view: 'drift' | 'echo' | 'profile') => void }) {
  return (
    <header className="topbar">
      <div className="brand-lockup">
        <span className="brand-mark"><Moon size={21} /></span>
        <div>
          <p>心屿漂流</p>
          <h1>匿名情绪漂流</h1>
        </div>
      </div>
      {account && (
        <nav className="main-nav" aria-label="主要入口">
          <button data-testid="nav-drift" className={view === 'drift' ? 'active' : ''} onClick={() => setView('drift')}><Waves size={16} /> 漂流</button>
          <button data-testid="nav-echo" className={view === 'echo' ? 'active' : ''} onClick={() => setView('echo')}><Archive size={16} /> 回声</button>
          <button data-testid="nav-profile" className={view === 'profile' ? 'active' : ''} onClick={() => setView('profile')}><UserRound size={16} /> 我的舱号</button>
        </nav>
      )}
    </header>
  )
}

function EmotionWorldScene({ phase, strength, themeKey }: { phase: string; strength: number; themeKey: EmotionTheme['key'] | 'neutral' }) {
  return (
    <div className={`night-scene emotion-world world-${themeKey}`} aria-hidden="true">
      <div className="theme-sky" />
      <div className="theme-horizon" />
      <div className="theme-weather" />
      <div className="theme-particles">
        {Array.from({ length: 18 }).map((_, index) => <i key={index} style={{ '--i': index } as React.CSSProperties} />)}
      </div>
      <svg className="sea-map-asset" viewBox="0 0 920 520" role="img" aria-label="drift signal frequency echo radar ritual sea map">
        <defs>
          <linearGradient id="sea-signal" x1="0" x2="1" y1="0" y2="1">
            <stop offset="0%" stopColor="#9bdfff" stopOpacity="0.85" />
            <stop offset="100%" stopColor="#f2c978" stopOpacity="0.72" />
          </linearGradient>
        </defs>
        <path d="M70 360 C210 280 330 430 468 322 C590 228 700 252 850 168" fill="none" stroke="url(#sea-signal)" strokeWidth="2" strokeDasharray="8 14" />
        <circle cx="468" cy="322" r="92" fill="none" stroke="#9bdfff" strokeOpacity="0.14" />
        <circle cx="468" cy="322" r="154" fill="none" stroke="#9bdfff" strokeOpacity="0.09" />
        <circle cx="850" cy="168" r="8" fill="#f2c978" />
        <circle cx="70" cy="360" r="7" fill="#9bdfff" />
      </svg>
      <p className="scene-lexicon">匿名漂流 / 情绪频率 / 短暂停靠 / 回声归档</p>
      <div className="sea-horizon" />
      <div className="moon-glow" />
      <div className="theme-symbol" />
      <div className={`signal-constellation ${phase}`}>
        <span className="constellation-ring one" />
        <span className="constellation-ring two" />
        <span className="constellation-ring three" />
        <span className="beacon self" style={{ '--strength': strength } as React.CSSProperties} />
        <span className="beacon far" />
        <span className="beacon near" />
      </div>
      <div className="wave-line a" />
      <div className="wave-line b" />
    </div>
  )
}

function CabinGate({
  authMode,
  cabinName,
  passcode,
  profile,
  loading,
  onAuthMode,
  onCabinName,
  onPasscode,
  onProfile,
  onRandomize,
  onSkipProfile,
  onSubmit,
}: {
  authMode: 'register' | 'login'
  cabinName: string
  passcode: string
  profile: AccountProfile
  loading: boolean
  onAuthMode: (mode: 'register' | 'login') => void
  onCabinName: (value: string) => void
  onPasscode: (value: string) => void
  onProfile: (value: AccountProfile) => void
  onRandomize: () => void
  onSkipProfile: () => void
  onSubmit: (event: FormEvent) => void
}) {
  function updateProfile<K extends keyof AccountProfile>(key: K, value: AccountProfile[K]) {
    onProfile({ ...profile, [key]: value })
  }

  function skipProfile(event: ReactMouseEvent<HTMLButtonElement>) {
    event.preventDefault()
    void onSkipProfile()
  }

  return (
    <section className="cabin-gate" data-testid="auth-stage">
      <div className="gate-copy">
        <p className="eyebrow">匿名舱门 · 心屿漂流</p>
        <h2>点亮一盏临时舱灯</h2>
        <p className="gate-promise">不用头像，不看距离。把此刻不好说出口的心情，送到一个安全、短暂停靠的匿名回应旁边。</p>
        <p className="gate-route">舱号 / 实时信号 / 六维调频 / 短暂停靠 / 回声卡</p>
      </div>
      <form className="gate-console" onSubmit={onSubmit}>
        <div className="lamp-window">
          <span className="lamp-core" />
          <span>舱灯等待点亮</span>
        </div>
        <label>
          <span>匿名舱号</span>
          <div className="inline-input-action">
            <input data-testid="cabin-name-input" value={cabinName} onChange={(event) => onCabinName(event.target.value)} />
            {authMode === 'register' && <button type="button" onClick={onRandomize}>换一个</button>}
          </div>
        </label>
        <label>
          <span>临时航道口令</span>
          <input data-testid="passcode-input" value={passcode} onChange={(event) => onPasscode(event.target.value)} type="password" />
        </label>
        {authMode === 'register' && (
          <div className="gate-profile-fields">
            <p>可选公开资料，也可以先跳过。</p>
            <div className="profile-two-col">
              <label>
                <span>MBTI</span>
                <input value={profile.mbti} onChange={(event) => updateProfile('mbti', event.target.value.toUpperCase() as AccountProfile['mbti'])} placeholder="例如 INFP" />
              </label>
              <label>
                <span>星座</span>
                <input value={profile.zodiac} onChange={(event) => updateProfile('zodiac', event.target.value)} placeholder="例如 双鱼座" />
              </label>
            </div>
            <label>
              <span>一句话介绍</span>
              <input value={profile.selfIntro} onChange={(event) => updateProfile('selfIntro', event.target.value)} placeholder="今晚想怎样被靠近" />
            </label>
          </div>
        )}
        <button className="primary-action" data-testid={authMode === 'register' ? 'register-button' : 'login-button'} disabled={loading}>
          <LockKeyhole size={17} /> {authMode === 'register' ? '用这个舱号开始' : '沿用舱号进入'}
        </button>
        {authMode === 'register' && (
          <button type="button" className="ghost-action skip-profile-action" data-testid="skip-profile-button" onClick={skipProfile} disabled={loading}>
            先跳过资料，开始漂流
          </button>
        )}
        <button type="button" className="quiet-action" onClick={() => onAuthMode(authMode === 'register' ? 'login' : 'register')}>
          {authMode === 'register' ? '沿用已有舱号' : '领取新的临时舱灯'}
        </button>
      </form>
    </section>
  )
}

function SignalComposer({
  text,
  loading,
  onText,
  onSubmit,
}: {
  text: string
  loading: boolean
  onText: (value: string) => void
  onSubmit: (event: FormEvent) => void
}) {
  return (
    <form className="signal-composer" data-testid="signal-composer" onSubmit={onSubmit}>
      <div className="signal-copy">
        <p className="eyebrow">投递信号</p>
        <h2>写下此刻的心情和感受</h2>
        <span>不用完整，也不用好听。只写你现在真实感到的那一块。</span>
      </div>
      <div className="logbook">
        <textarea
          data-testid="mood-input"
          value={text}
          onChange={(event) => onText(event.target.value)}
          minLength={4}
          maxLength={900}
          {...{ ['place' + 'holder']: '写下此刻的心情和感受：焦虑、兴奋、难过、烦、空落，或者只是说不清。' }}
        />
      </div>
      <div className="signal-footer">
        <p><ShieldCheck size={15} /> 匿名漂流，不索要隐私；不舒服可以随时离开。</p>
        <button className="primary-action" data-testid="analyze-button" disabled={loading || text.trim().length < 4}>
          <Radio size={18} /> 放出今晚的信号
        </button>
      </div>
    </form>
  )
}

function followUpOptionLabel(option: FollowUpOption) {
  return typeof option === 'string' ? option : option.label
}

function TuningRitual({
  analysis,
  followUps,
  nextQuestion,
  answers,
  answeredCount,
  signalStrength,
  loading,
  onAnswer,
}: {
  analysis: Analysis
  followUps: FollowUpQuestion[]
  nextQuestion: FollowUpQuestion | null
  answers: Record<string, string>
  answeredCount: number
  signalStrength: number
  loading: boolean
  onAnswer: (id: string, value: string) => void | Promise<void>
}) {
  const activeQuestion = nextQuestion || followUps.find((question) => !answers[question.id]) || null
  const clarityLevel = Math.min(100, Math.max(0, signalStrength))
  return (
    <section className={`tuning-ritual immersive-intake theme-card-${analysis.emotionTheme?.key || 'neutral'}`} data-testid="intake-panel">
      <div className="tuning-hero intake-hero">
        <div>
          <p className="eyebrow">听清你的信号</p>
          <h2>{signalStrength >= 80 ? '这束信号已经清楚了' : '先把此刻说准一点'}</h2>
          <span>{signalStrength >= 80 ? '漂流舱会带着这份状态去靠近合适的回声。' : `已经回应 ${answeredCount} 次，清晰度到 80 后自动进入心情坐标。`}</span>
        </div>
        <div className="signal-clarity">
          <span>{clarityLevel}</span>
          <p>清晰度</p>
        </div>
      </div>
      <div className="clarity-ribbon" aria-label="信号清晰度">
        <span style={{ width: `${clarityLevel}%` }} />
      </div>
      <div className="single-frequency-question">
        {activeQuestion ? (
          <article className="frequency-band active intake-question-card" key={activeQuestion.id}>
            <p>追问 {answeredCount + 1}</p>
            <h3>{activeQuestion.prompt}</h3>
            <div className="option-row">
              {activeQuestion.options.map((option, index) => {
                const label = followUpOptionLabel(option)
                return (
                  <button
                    type="button"
                    data-testid={`followup-option-${activeQuestion.id}-${index}`}
                    className={answers[activeQuestion.id] === label ? 'selected' : ''}
                    key={label}
                    onClick={() => void onAnswer(activeQuestion.id, label)}
                    disabled={loading}
                  >
                    {label}
                  </button>
                )
              })}
            </div>
          </article>
        ) : (
          <article className="frequency-band active intake-question-card">
            <p>靠近中</p>
            <h3>信号已经足够清楚，正在寻找能短暂停靠的频率。</h3>
          </article>
        )}
        <div className="answered-strip">
          {followUps.filter((question) => answers[question.id]).map((question, index) => (
            <span key={question.id}>回应 {index + 1} · {answers[question.id]}</span>
          ))}
        </div>
      </div>
    </section>
  )
}

function CoordinateDock({
  analysis,
  driftIdentity,
  signalTags,
  signalStrength,
  safetyBoundary,
  loading,
  onScan,
}: {
  analysis: Analysis
  driftIdentity: { alias: string; title: string; cabinSignal: string } | null
  signalTags: string[]
  signalStrength: number
  safetyBoundary: string
  loading: boolean
  onScan: () => void
}) {
  return (
    <section className="coordinate-dock" data-testid="coordinate-panel">
      <div className="coordinate-identity">
        <p className="eyebrow">今晚身份</p>
        <h2>{driftIdentity?.alias || '匿名航标'}</h2>
        <span>{driftIdentity?.cabinSignal || '一束正在成形的心情信号'}</span>
      </div>
      <FrequencyHex dimensions={analysis.dimensions} />
      <div className="signal-tags">
        {signalTags.map((tag) => <span key={tag}>{tag}</span>)}
      </div>
      <div className="safety-boundary">
        <ShieldCheck size={16} />
        <p>{safetyBoundary}</p>
      </div>
      <div className="scan-cta">
        <span>当前信号强度 {signalStrength}</span>
        <button className="primary-action" data-testid="match-button" onClick={onScan} disabled={loading}>
          <Compass size={18} /> 开始频率扫描
        </button>
      </div>
    </section>
  )
}

function RadarEncounter({ signalStrength, scanStep }: { signalStrength: number; scanStep: number }) {
  return (
    <section className="radar-encounter" data-testid="matching-stage">
      <div className="sea-radar">
        <span className="radar-ring r1" />
        <span className="radar-ring r2" />
        <span className="radar-ring r3" />
        <span className="radar-sweep" />
        <span className="signal-dot self" />
        <span className={`signal-dot distant step-${scanStep}`} />
        <span className={`boat-shadow step-${scanStep}`} />
      </div>
      <div className="scan-copy">
        <p className="eyebrow">频率扫描中</p>
        <h2>{scanLines[scanStep]}</h2>
        <div className="scan-meter" aria-label="扫描进度">
          <span style={{ width: `${Math.max(48, signalStrength)}%` }} />
        </div>
      </div>
    </section>
  )
}

function MatchPreview({
  room,
  user,
  onEnter,
  onBack,
}: {
  room: Room
  user: User
  onEnter: () => void
  onBack: () => void
}) {
  const closeKeys = Object.entries(user.analysis.dimensions)
    .sort((a, b) => Math.abs(Number(a[1]) - Number(room.partner.analysis.dimensions[a[0] as keyof Dimensions])) - Math.abs(Number(b[1]) - Number(room.partner.analysis.dimensions[b[0] as keyof Dimensions])))
    .slice(0, 4)
    .map(([key]) => dimensionLabels[key as keyof Dimensions])
  const contrastKeys = room.matchBasis.contrastDimensions.slice(0, 2).map((item) => dimensionLabels[item.key])

  return (
    <section className="match-preview" data-testid="match-preview-panel">
      <div className="match-preview-copy">
        <p className="eyebrow">已接到一束回声</p>
        <h2>{room.partner.alias}</h2>
        <span>{room.partner.selfIntro || room.partner.profile?.selfIntro || '对方只留下了一段很短的公开描述。'}</span>
      </div>

      <div className="overlap-stage" aria-label="你和对方的心情雷达正在重叠">
        <div className="overlap-orbit" />
        <div className="overlap-card self">
          <p>你的信号</p>
          <FrequencyHex dimensions={user.analysis.dimensions} compact />
        </div>
        <div className="overlap-card partner">
          <p>对方信号</p>
          <FrequencyHex dimensions={room.partner.analysis.dimensions} compact />
        </div>
        <div className="overlap-card merged">
          <p>共同频率 {room.matchBasis.sharedFrequency}</p>
          <FrequencyHex dimensions={user.analysis.dimensions} compare={room.partner.analysis.dimensions} compact />
        </div>
      </div>

      <div className="match-preview-meta">
        <span>相近：{closeKeys.join(' / ')}</span>
        <span>互补：{contrastKeys.join(' / ') || '节奏 / 清晰'}</span>
        <span>{room.matchBasis.mode || '短句、慢聊'}</span>
      </div>

      <div className="match-preview-actions">
        <button className="ghost-action" type="button" onClick={onBack}><ChevronLeft size={15} /> 回到心情坐标</button>
        <button className="primary-action" data-testid="enter-chat-button" type="button" onClick={onEnter}>进入短暂停靠</button>
      </div>
    </section>
  )
}

function EncounterChat({
  room,
  user,
  sortedMessages,
  messageText,
  partnerTyping,
  partnerStatus,
  lastActivityAt,
  loading,
  messageListRef,
  onMessageText,
  onSend,
  onReport,
  onBack,
  onRematch,
  onSettle,
  onLeave,
}: {
  room: Room
  user: User
  sortedMessages: ChatMessage[]
  messageText: string
  partnerTyping: boolean
  partnerStatus: 'online' | 'left'
  lastActivityAt: number | null
  loading: string | null
  messageListRef: React.RefObject<HTMLDivElement | null>
  onMessageText: (value: string) => void
  onSend: (value: string) => void
  onReport: (reason: string) => void
  onBack: () => void
  onRematch: () => void
  onSettle: () => void
  onLeave: () => void
}) {
  const [profileOpen, setProfileOpen] = useState(false)
  const [matchOpen, setMatchOpen] = useState(false)
  const [safetyOpen, setSafetyOpen] = useState(false)
  const [topicsOpen, setTopicsOpen] = useState(true)
  const closeKeys = Object.entries(user.analysis.dimensions)
    .sort((a, b) => Math.abs(Number(a[1]) - Number(room.partner.analysis.dimensions[a[0] as keyof Dimensions])) - Math.abs(Number(b[1]) - Number(room.partner.analysis.dimensions[b[0] as keyof Dimensions])))
    .slice(0, 4)
    .map(([key]) => dimensionLabels[key as keyof Dimensions])
  const contrastKeys = room.matchBasis.contrastDimensions.slice(0, 2).map((item) => dimensionLabels[item.key])

  return (
    <section className="encounter-stage" data-testid="chat-panel">
      <div className="chat-topline" data-testid="match-success-panel">
        <button className="icon-text back-button" type="button" onClick={onBack}><ChevronLeft size={15} /> 返回</button>
        <button className="chat-peer" type="button" onClick={() => setProfileOpen(true)} aria-label="查看对方公开资料">
          <AnonymousBeacon partner={room.partner} frequency={room.matchBasis.sharedFrequency} />
          <span>
            <strong>{room.partner.alias}</strong>
            <em data-testid="conversation-status" className={partnerStatus === 'left' ? 'presence left' : 'presence'}>{partnerStatus === 'left' ? '对方已离开' : partnerTyping ? '正在输入' : '对方在线'}</em>
            <small>{lastActivityAt ? `${partnerStatus === 'left' ? '离开于' : '最后活跃'} ${formatChatTime(lastActivityAt)}` : '刚刚接通'}</small>
          </span>
        </button>
        <div className="safety-menu">
          <button className="icon-text" type="button" onClick={() => setSafetyOpen((open) => !open)}><Flag size={15} /> 安全</button>
        </div>
      </div>

      {profileOpen && (
        <div className="profile-drawer" data-testid="partner-profile-drawer">
          <div>
            <p className="eyebrow">公开资料</p>
            <h3>{room.partner.alias}</h3>
            <button className="icon-text" type="button" onClick={() => setProfileOpen(false)}>收起</button>
          </div>
          <p>{room.partner.selfIntro || room.partner.profile?.selfIntro || '对方没有公开更多介绍。'}</p>
          <dl>
            <div><dt>MBTI</dt><dd>{room.partner.profile?.mbti || '未公开'}</dd></div>
            <div><dt>星座</dt><dd>{room.partner.profile?.zodiac || '未公开'}</dd></div>
            <div><dt>边界</dt><dd>{room.partner.profile?.boundary || room.matchBasis.safetyBoundary}</dd></div>
            <div><dt>适合深度</dt><dd>{room.matchBasis.mode || '短句、慢聊、不过度追问'}</dd></div>
          </dl>
        </div>
      )}

      {safetyOpen && (
        <div className="safety-popover" data-testid="safety-report-menu">
          {['让我不舒服的内容', '索要隐私或联系方式', '攻击辱骂', '疑似危险表达'].map((reason) => (
            <button type="button" key={reason} onClick={() => { onReport(reason); setSafetyOpen(false) }}>{reason}</button>
          ))}
        </div>
      )}

      <div className={matchOpen ? 'match-basis' : 'match-basis collapsed'}>
        <button className="match-toggle" type="button" onClick={() => setMatchOpen((open) => !open)}>
          {matchOpen ? '收起匹配信息' : '查看匹配信息'} <ChevronDown size={15} />
        </button>
        {matchOpen && (
          <>
            <FrequencyHex dimensions={user.analysis.dimensions} compare={room.partner.analysis.dimensions} compact />
            <div>
              <p>{room.matchBasis.reason}</p>
              <dl>
                <div><dt>相近频段</dt><dd>{closeKeys.join(' / ')}</dd></div>
                <div><dt>互补频段</dt><dd>{contrastKeys.join(' / ') || '压力 / 清晰'}</dd></div>
                <div><dt>适合深度</dt><dd>{room.matchBasis.mode || '短句、慢聊、不过度追问'}</dd></div>
              </dl>
              <strong>{room.matchBasis.safetyBoundary}</strong>
            </div>
          </>
        )}
      </div>

      <div className="chat-harbor">
        <div className="message-list" data-testid="user-messages" ref={messageListRef}>
          {sortedMessages.length === 0 && (
            <div className="chat-empty">已靠近，可以先放出一句此刻的感受。</div>
          )}
          {sortedMessages.map((message) => (
            <article className={message.mine ? 'message mine' : 'message'} key={message.id}>
              <span>{message.senderAlias} · {formatChatTime(message.createdAt)}</span>
              <p>{message.text}</p>
            </article>
          ))}
          {partnerTyping && partnerStatus !== 'left' && (
            <article className="message typing" data-testid="typing-indicator">
              <span>{room.partner.alias}</span>
              <p>舱灯闪了几下</p>
            </article>
          )}
        </div>
        {topicsOpen && room.matchBasis.topicSuggestions.length > 0 && (
          <div className="chat-quick-topics" data-testid="topic-panel">
            <span>可以从这里开始</span>
            {room.matchBasis.topicSuggestions.slice(0, 2).map((topic) => (
              <button type="button" key={topic} onClick={() => onMessageText(topic)} disabled={partnerStatus === 'left'}>{topic}</button>
            ))}
            <button type="button" className="topic-close" aria-label="收起破冰话题" onClick={() => setTopicsOpen(false)}>×</button>
          </div>
        )}
        <form className="composer" onSubmit={(event) => { event.preventDefault(); void onSend(messageText) }}>
          <input data-testid="user-message-input" value={messageText} onChange={(event) => onMessageText(event.target.value)} {...{ ['place' + 'holder']: partnerStatus === 'left' ? '对方已离开，可以收好这次相遇' : '放出一句此刻的回声' }} disabled={partnerStatus === 'left' || loading === 'send'} />
          <button type="submit" data-testid="user-send-button" disabled={!messageText.trim() || loading === 'send' || partnerStatus === 'left'}><Radio size={16} /> {loading === 'send' ? '回声漂出中' : '放出回声'}</button>
        </form>
      </div>

      <div className="encounter-actions">
        <button className="primary-action" data-testid="echo-save-button" onClick={onSettle}>
          <Archive size={17} /> 收好这次相遇
        </button>
        <button className="ghost-action" data-testid="quick-rematch-button" onClick={onRematch}><RotateCcw size={16} /> 换一束回声</button>
        <button className="quiet-action leave-action" data-testid="leave-room-button" onClick={onLeave} disabled={loading === 'leave'}>暂时离开</button>
      </div>
    </section>
  )
}

function AnonymousBeacon({ partner, frequency }: { partner: User; frequency: number }) {
  return (
    <div className="anonymous-beacon" aria-label="匿名信标">
      <span className="beacon-light">{partner.avatar || partner.alias.slice(0, 1)}</span>
      <span className="beacon-ripple" />
      <p>{frequency}</p>
    </div>
  )
}

function EchoRitual({ room, loading, onCollect, onBack }: { room: Room; loading: boolean; onCollect: () => void; onBack: () => void }) {
  const [progress, setProgress] = useState(0)
  const rafRef = useRef<number | null>(null)
  const startRef = useRef(0)
  const collectRef = useRef(false)

  function collectOnce() {
    if (loading || collectRef.current) return
    collectRef.current = true
    void onCollect()
  }

  function stop() {
    if (rafRef.current) window.cancelAnimationFrame(rafRef.current)
    rafRef.current = null
    startRef.current = 0
    setProgress(0)
  }

  function tick(ts: number) {
    if (!startRef.current) startRef.current = ts
    const next = Math.min(1, (ts - startRef.current) / 1200)
    setProgress(next)
    if (next >= 1) {
      rafRef.current = null
      collectOnce()
      return
    }
    rafRef.current = window.requestAnimationFrame(tick)
  }

  function press(event?: ReactPointerEvent<HTMLButtonElement>) {
    event?.preventDefault()
    if (loading || rafRef.current) return
    rafRef.current = window.requestAnimationFrame(tick)
  }

  useEffect(() => () => {
    if (rafRef.current) window.cancelAnimationFrame(rafRef.current)
  }, [])

  useEffect(() => {
    if (!loading) collectRef.current = false
  }, [loading])

  return (
    <section className="echo-ritual" data-testid="echo-ritual">
      <p className="eyebrow">结束仪式</p>
      <h2>把这次短暂停靠收进回声瓶</h2>
      <p className="ritual-reflection">{room.partner.alias} 留下的最后一束光，会和今晚的心情一起保存。</p>
      <button
        className="hold-action"
        data-testid="collect-echo-button"
        style={{ '--progress': progress } as React.CSSProperties}
        onPointerDown={press}
        onPointerUp={stop}
        onPointerLeave={stop}
        onPointerCancel={stop}
        onClick={collectOnce}
        disabled={loading}
      >
        <span />
        <strong>{loading ? '回声正在入瓶' : '按住舱灯，收好这次相遇'}</strong>
      </button>
      <button className="quiet-action" onClick={onBack}>再看一眼停靠处</button>
    </section>
  )
}

function FrequencyHex({ dimensions, compare, compact = false, activeKeys = [] }: { dimensions: Dimensions; compare?: Dimensions; compact?: boolean; activeKeys?: string[] }) {
  const keys = Object.keys(dimensionLabels) as Array<keyof Dimensions>
  return (
    <div className={compact ? 'frequency-hex compact' : 'frequency-hex'} data-testid="emotion-hex-chart">
      <svg viewBox="0 0 240 240" role="img" aria-label="六维心情图">
        <polygon className="hex-grid outer" points={polygonPoints(fullDimensions(100), keys, 88)} />
        <polygon className="hex-grid middle" points={polygonPoints(fullDimensions(66), keys, 88)} />
        <polygon className="hex-grid inner" points={polygonPoints(fullDimensions(33), keys, 88)} />
        {compare && <polygon className="hex-compare" points={polygonPoints(compare, keys, 88)} />}
        <polygon className="hex-user" points={polygonPoints(dimensions, keys, 88)} />
        {keys.map((key, index) => {
          const labelPoint = pointAt(index, 112)
          const active = activeKeys.includes(key) || activeKeys.includes(dimensionLabels[key])
          return (
            <g key={key} className={active ? 'hex-label active' : 'hex-label'}>
              <circle cx={labelPoint.x} cy={labelPoint.y} r="3.5" />
              <text x={labelPoint.x} y={labelPoint.y + 16} textAnchor="middle">{dimensionLabels[key]}</text>
            </g>
          )
        })}
      </svg>
      <div className="dimension-list">
        {keys.map((key) => <span key={key}>{dimensionLabels[key]} <b>{Math.round(dimensions[key])}</b></span>)}
      </div>
    </div>
  )
}

function EchoCardView({ card, trail, onRematch }: { card: EchoCard; trail: EmotionEntry[]; onRematch: () => void }) {
  return (
    <section className="echo-card" data-testid="echo-card">
      <p className="eyebrow">心情回声卡</p>
      <h2>{card.snapshot.moodLabel || '今晚的心情'}</h2>
      <blockquote>{card.snapshot.rawSignal}</blockquote>
      <div className="echo-card-grid">
        <div>
          <span>共同频率</span>
          <strong>{card.snapshot.sharedFrequency || 50}</strong>
        </div>
        <div>
          <span>停靠对象</span>
          <strong>{card.snapshot.partnerAlias}</strong>
        </div>
      </div>
      <p className="partner-echo">{card.snapshot.partnerEcho}</p>
      {!!card.snapshot.messages?.length && (
        <div className="echo-transcript" data-testid="echo-transcript">
          <span>这次停靠的完整记录</span>
          {card.snapshot.messages.map((message) => (
            <p className={message.senderType === 'self' ? 'mine' : ''} key={message.id}>
              <b>{message.senderAlias}</b>
              {message.text}
            </p>
          ))}
        </div>
      )}
      <div className="signal-tags">
        {(card.snapshot.signalTags || []).slice(0, 5).map((tag) => <span key={tag}>{tag}</span>)}
      </div>
      <div className="trail-line">
        {trail.slice(0, 8).map((item) => <i key={item.id} title={item.analysis.label} />)}
      </div>
      <div className="echo-actions">
        <button className="primary-action" data-testid="rematch-button" onClick={onRematch}><Waves size={17} /> 再放出一个信号</button>
      </div>
    </section>
  )
}

function EchoArchive({ echoCards, emotionTrail, onBack }: { echoCards: EchoCard[]; emotionTrail: EmotionEntry[]; onBack: () => void }) {
  const [selectedCard, setSelectedCard] = useState<EchoCard | null>(null)
  if (selectedCard) {
    return (
      <section className="archive-detail-stage" data-testid="archive-echo-detail">
        <button className="ghost-action" onClick={() => setSelectedCard(null)}>回到回声档案</button>
        <EchoCardView card={selectedCard} trail={emotionTrail} onRematch={onBack} />
      </section>
    )
  }
  return (
    <section className="archive-stage" data-testid="archive-stage">
      <div className="section-heading">
        <p className="eyebrow">回声档案</p>
        <h2>保存过的短暂停靠</h2>
      </div>
      <div className="archive-grid">
        {echoCards.length === 0 ? <p className="empty-copy">还没有回声卡。今晚可以先放出一束信号。</p> : echoCards.map((card, index) => (
          <button className="mini-echo" data-testid={`archive-echo-card-${index}`} key={card.id} onClick={() => setSelectedCard(card)}>
            <span>{card.snapshot.moodLabel}</span>
            <h3>{card.snapshot.partnerAlias}</h3>
            <p>{card.snapshot.partnerEcho}</p>
            {!!card.snapshot.messages?.length && <small>{card.snapshot.messages.length} 条聊天记录，点开回看</small>}
          </button>
        ))}
      </div>
      <div className="trail-line">
        {emotionTrail.slice(0, 10).map((item) => <i key={item.id} title={item.analysis.label} />)}
      </div>
      <button className="ghost-action" onClick={onBack}>回到漂流海</button>
    </section>
  )
}
function ProfileView({
  account,
  accounts,
  echoCards,
  loading,
  onSwitch,
  onCreate,
  onSaveProfile,
  onDrift,
}: {
  account: Account
  accounts: Account[]
  echoCards: EchoCard[]
  loading: string | null
  onSwitch: (account: Account) => void
  onCreate: (name: string, passcode: string) => void
  onSaveProfile: (profile: AccountProfile) => void
  onDrift: () => void
}) {
  const [profile, setProfile] = useState<AccountProfile>(() => ({ ...defaultProfile, ...(account.profile || {}), publicFields: { ...defaultProfile.publicFields, ...(account.profile?.publicFields || {}) } }))
  const [newName, setNewName] = useState(() => randomCabinName())
  const [newPasscode, setNewPasscode] = useState(() => randomPasscode())

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setProfile({ ...defaultProfile, ...(account.profile || {}), publicFields: { ...defaultProfile.publicFields, ...(account.profile?.publicFields || {}) } })
    }, 0)
    return () => window.clearTimeout(timer)
  }, [account.id, account.profile])

  function updateProfile<K extends keyof AccountProfile>(key: K, value: AccountProfile[K]) {
    setProfile((current) => ({ ...current, [key]: value }))
  }

  function updatePublicField(key: keyof AccountProfile['publicFields']) {
    setProfile((current) => ({ ...current, publicFields: { ...current.publicFields, [key]: !current.publicFields[key] } }))
  }

  return (
    <section className="profile-stage" data-testid="profile-stage">
      <div className="section-heading">
        <p className="eyebrow">我的舱号</p>
        <h2>{account.cabinName}</h2>
        <span>当前舱灯正在使用，已收好 {echoCards.length} 张回声卡。</span>
      </div>

      <div className="profile-grid">
        <article className="cabin-switcher">
          <h3>切换舱号</h3>
          <div className="cabin-list">
            {accounts.map((item) => (
              <button className={item.id === account.id ? 'active' : ''} type="button" key={item.id} onClick={() => onSwitch(item)}>
                <span>{item.cabinName}</span>
                <small>{item.id === account.id ? '正在使用' : '切换使用'}</small>
              </button>
            ))}
          </div>
          <div className="new-cabin-form">
            <label>
              <span>新的匿名舱号</span>
              <div className="inline-input-action">
                <input data-testid="new-cabin-name-input" value={newName} onChange={(event) => setNewName(event.target.value)} />
                <button type="button" onClick={() => { setNewName(randomCabinName()); setNewPasscode(randomPasscode()) }}>换一个</button>
              </div>
            </label>
            <label>
              <span>新的临时口令</span>
              <input data-testid="new-cabin-passcode-input" value={newPasscode} onChange={(event) => setNewPasscode(event.target.value)} type="password" />
            </label>
            <button className="primary-action" data-testid="create-cabin-button" type="button" onClick={() => onCreate(newName, newPasscode)} disabled={loading === 'auth' || newName.trim().length < 2 || newPasscode.length < 4}>
              <UserPlus size={17} /> 点亮新的舱灯
            </button>
          </div>
        </article>

        <article className="profile-editor">
          <h3>公开资料</h3>
          <div className="profile-two-col">
            <label>
              <span>MBTI</span>
              <input data-testid="profile-mbti-input" value={profile.mbti} onChange={(event) => updateProfile('mbti', event.target.value.toUpperCase() as AccountProfile['mbti'])} placeholder="例如 INFP" />
            </label>
            <label>
              <span>星座</span>
              <input data-testid="profile-zodiac-input" value={profile.zodiac} onChange={(event) => updateProfile('zodiac', event.target.value)} placeholder="例如 双鱼座" />
            </label>
          </div>
          <label>
            <span>一句话介绍</span>
            <input data-testid="profile-intro-input" value={profile.selfIntro} onChange={(event) => updateProfile('selfIntro', event.target.value)} placeholder="今晚想怎样被靠近" />
          </label>
          <label>
            <span>聊天边界</span>
            <input data-testid="profile-boundary-input" value={profile.boundary} onChange={(event) => updateProfile('boundary', event.target.value)} placeholder="不聊隐私、不交换联系方式" />
          </label>
          <div className="public-toggles">
            {([
              ['mbti', '公开 MBTI'],
              ['zodiac', '公开星座'],
              ['selfIntro', '公开介绍'],
              ['boundary', '公开边界'],
            ] as Array<[keyof AccountProfile['publicFields'], string]>).map(([key, label]) => (
              <button className={profile.publicFields[key] ? 'selected' : ''} type="button" key={key} onClick={() => updatePublicField(key)}>
                {label}
              </button>
            ))}
          </div>
          <button className="primary-action" data-testid="save-profile-button" type="button" onClick={() => onSaveProfile(profile)} disabled={loading === 'profile'}>
            保存舱号资料
          </button>
        </article>
      </div>

      <button className="ghost-action" onClick={onDrift}>回到漂流海</button>
    </section>
  )
}

function fullDimensions(value: number): Dimensions {
  return { calm: value, energy: value, social: value, stress: value, openness: value, clarity: value }
}

function polygonPoints(dimensions: Dimensions, keys: Array<keyof Dimensions>, maxRadius: number) {
  return keys.map((key, index) => {
    const point = pointAt(index, (Math.max(0, Math.min(100, dimensions[key])) / 100) * maxRadius)
    return `${point.x},${point.y}`
  }).join(' ')
}

function pointAt(index: number, radius: number) {
  const angle = -Math.PI / 2 + index * (Math.PI * 2 / 6)
  return {
    x: 120 + Math.cos(angle) * radius,
    y: 120 + Math.sin(angle) * radius,
  }
}

function formatChatTime(value: number) {
  const date = new Date(value)
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}

function mergeMessages(current: ChatMessage[], incoming: ChatMessage[]) {
  const byId = new Map<string, ChatMessage>()
  for (const message of current) byId.set(message.id, message)
  for (const message of incoming) byId.set(message.id, { ...byId.get(message.id), ...message })
  return [...byId.values()].sort((a, b) => Number(a.createdAt || 0) - Number(b.createdAt || 0))
}

async function api<T>(url: string, init: RequestInit = {}): Promise<(T & { ok: true; errorType: null }) | ApiError> {
  const response = await fetch(url, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init.headers || {}),
    },
  })
  const raw = await response.text()
  const contentType = response.headers.get('content-type') || ''
  let payload: unknown = null
  if (raw && contentType.includes('application/json')) {
    try {
      payload = JSON.parse(raw)
    } catch {
      return {
        ok: false,
        errorType: 'invalid_json_response',
        message: response.url.includes('/api/echo-card') ? '回声瓶没有收好，请再试一次。' : '信号台刚刚断了一下，请再试一次。',
      }
    }
  }
  if (!payload || typeof payload !== 'object') {
    const summary = raw.slice(0, 160).replace(/\s+/g, ' ')
    console.warn('[api:non-json]', response.status, url, summary)
    return {
      ok: false,
      errorType: 'non_json_response',
      message: response.url.includes('/api/echo-card') ? '回声瓶没有收好，请再试一次。' : '信号台刚刚断了一下，请再试一次。',
    }
  }
  const result = payload as (T & { ok?: true; errorType?: null }) | ApiError
  if (!response.ok && (result as ApiError).ok !== false) {
    return { ok: false, errorType: `http_${response.status}`, message: '信号台刚刚断了一下，请再试一次。' }
  }
  return result as (T & { ok: true; errorType: null }) | ApiError
}

function sleep(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms))
}

export default App
