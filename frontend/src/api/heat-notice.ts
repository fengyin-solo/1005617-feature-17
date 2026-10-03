import { filterRows } from './local-service'
import { listRows, saveRows } from '@/data/local-store'
import type {
  EntryRow,
  HeatNotice,
  NoticeDraft,
  NoticeStatus,
  OperatorContext,
  PublicNotice,
  ReissueItem,
  RevokeDraft,
} from '@/data/types'

// 停暖通知专用窗口：权限、归属、单向状态机都在这里收口，不走各模块通用的 runAction。
const MODULE_KEY = 'heatnotice'

const STATUSES: NoticeStatus[] = ['待拟稿', '待发布', '已发布', '已撤销']

// 通知沿用既有口径，对外只使用这几项已有字段，撤销单明确告知已撤销。
function publishedWording(notice: HeatNotice): string {
  return `【停暖通知】${notice.影响片区}因${notice.停暖原因}，计划 ${notice.计划开始} 至 ${notice.计划恢复} 暂停供热，发布人：${notice.发布人}，通知方式：${notice.通知方式}。`
}

function revokedWording(notice: HeatNotice): string {
  return `【停暖通知已撤销】${notice.通知编号}（${notice.影响片区}）原计划 ${notice.计划开始} 至 ${notice.计划恢复} 的停暖通知已由${notice.撤销人}撤销，请勿再按原通知口径执行；撤销原因：${notice.撤销原因 || '未填写'}。`
}

function isLeader(ctx: OperatorContext): boolean {
  return ctx.role === 'shift_leader'
}

function isSameDistrictAdmin(notice: HeatNotice, ctx: OperatorContext): boolean {
  return ctx.role === 'duty_admin' && ctx.district !== '' && ctx.district === notice.拟稿人片区
}

/** 时间字段只接受「YYYY-MM-DD HH:mm」或「YYYY-MM-DDTHH:mm」，非法值一律解析失败退回重填。 */
function parseDateTime(value: string): Date | null {
  const text = value.trim()
  const match = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})$/.exec(text)
  if (!match) {
    return null
  }
  const [, y, m, d, hh, mm] = match
  const date = new Date(Number(y), Number(m) - 1, Number(d), Number(hh), Number(mm), 0, 0)
  if (
    date.getFullYear() !== Number(y) ||
    date.getMonth() !== Number(m) - 1 ||
    date.getDate() !== Number(d) ||
    date.getHours() !== Number(hh) ||
    date.getMinutes() !== Number(mm)
  ) {
    return null
  }
  return date
}

function nowText(): string {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

function loadNotices(): HeatNotice[] {
  return listRows(MODULE_KEY).map((row) => ({ ...(row as unknown as HeatNotice) }))
}

function persist(rows: HeatNotice[]): void {
  saveRows(MODULE_KEY, rows as unknown as EntryRow[])
}

function findIndex(rows: HeatNotice[], id: number): number {
  return rows.findIndex((row) => Number(row.id) === id)
}

/** 列表与详情走同一份取数：所有页面都只从这里读，不再各写各的过滤。 */
export function notices(filters: Record<string, string> = {}): HeatNotice[] {
  return filterRows(loadNotices() as unknown as EntryRow[], filters) as unknown as HeatNotice[]
}

export function noticeById(id: number): HeatNotice | null {
  return loadNotices().find((row) => Number(row.id) === id) ?? null
}

/** 页面按状态/权限决定按钮显隐，服务端再校验一遍，两层都不让越权。 */
export function canEdit(notice: HeatNotice, ctx: OperatorContext): boolean {
  return notice.status === '待拟稿' && isSameDistrictAdmin(notice, ctx)
}

export function canSubmit(notice: HeatNotice, ctx: OperatorContext): boolean {
  return notice.status === '待拟稿' && isSameDistrictAdmin(notice, ctx)
}

export function canPublish(notice: HeatNotice, ctx: OperatorContext): boolean {
  return notice.status === '待发布' && isLeader(ctx)
}

export function canRevoke(notice: HeatNotice, ctx: OperatorContext): boolean {
  return notice.status === '已发布' && isLeader(ctx)
}

export function canRedraft(notice: HeatNotice, ctx: OperatorContext): boolean {
  return notice.status === '已撤销' && isSameDistrictAdmin(notice, ctx)
}

export function canCreate(ctx: OperatorContext): boolean {
  return ctx.role === 'duty_admin' && ctx.district !== ''
}

function validateDraft(
  draft: Pick<NoticeDraft, '停暖原因' | '计划开始' | '计划恢复' | '通知方式'>,
): string | null {
  if (!draft.停暖原因.trim()) {
    return '停暖原因不能为空，请退回重填'
  }
  if (!draft.通知方式.trim()) {
    return '通知方式不能为空，请退回重填'
  }
  const start = parseDateTime(draft.计划开始)
  if (!start) {
    return '计划开始时间格式非法（应为 YYYY-MM-DD HH:mm），请退回重填'
  }
  const resume = parseDateTime(draft.计划恢复)
  if (!resume) {
    return '计划恢复时间格式非法（应为 YYYY-MM-DD HH:mm），请退回重填'
  }
  if (resume.getTime() <= start.getTime()) {
    return '计划恢复时间必须晚于计划开始时间，请退回重填'
  }
  return null
}

/** 登记停暖通知单：只有本片区值班管理员能登记，影响片区强制取其归属片区，不让自由改。 */
export function createNotice(draft: NoticeDraft, ctx: OperatorContext): { ok: boolean; message: string; id?: number } {
  if (!canCreate(ctx)) {
    return { ok: false, message: '越权操作已拒绝：只有本片区值班管理员能登记停暖通知单，值班长不拟稿' }
  }
  const invalid = validateDraft(draft)
  if (invalid) {
    return { ok: false, message: invalid }
  }
  const rows = loadNotices()
  const seq = rows.reduce((max, row) => Math.max(max, Number(row.id)), 0) + 1
  const year = new Date().getFullYear()
  const notice: HeatNotice = {
    id: seq,
    status: '待拟稿',
    pending: true,
    abnormal: false,
    通知编号: `TZ-${year}-${String(seq).padStart(4, '0')}`,
    影响片区: ctx.district,
    停暖原因: draft.停暖原因.trim(),
    计划开始: draft.计划开始.trim(),
    计划恢复: draft.计划恢复.trim(),
    通知方式: draft.通知方式.trim(),
    发布人: '',
    通知状态: '待拟稿',
    拟稿人: ctx.operator,
    拟稿人片区: ctx.district,
    提交时间: '',
    发布时间: '',
    撤销人: '',
    撤销时间: '',
    撤销原因: '',
    来源通知单: '',
  }
  persist([...rows, notice])
  return { ok: true, message: `停暖通知单 ${notice.通知编号} 已登记，当前状态「待拟稿」`, id: notice.id }
}

/** 改通知单：仅本片区值班管理员、仅待拟稿阶段；影响片区归属定死，不接受改动。 */
export function updateNotice(id: number, draft: NoticeDraft, ctx: OperatorContext): { ok: boolean; message: string } {
  const rows = loadNotices()
  const index = findIndex(rows, id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的停暖通知单` }
  }
  const current = rows[index]
  if (current.status === '已撤销') {
    return { ok: false, message: `通知单 ${current.通知编号} 已撤销，整单只读不能修改；需要调整请另起一条重新拟稿` }
  }
  if (isLeader(ctx)) {
    return { ok: false, message: '越权改动已拒绝：值班长只负责发布与撤销，不能改通知单内容' }
  }
  if (!isSameDistrictAdmin(current, ctx)) {
    return { ok: false, message: `越权改动已拒绝：通知单 ${current.通知编号} 归属${current.拟稿人片区}，只有本片区值班管理员能改` }
  }
  if (current.status !== '待拟稿') {
    return { ok: false, message: `通知单已进入「${current.status}」，拟稿内容锁定，回退改动一律打回；需要调整请走撤销后重新拟稿` }
  }
  const invalid = validateDraft(draft)
  if (invalid) {
    return { ok: false, message: invalid }
  }
  rows[index] = {
    ...current,
    // 影响片区不随表单走：归属在登记时已定，谁都不能改。
    影响片区: current.影响片区,
    停暖原因: draft.停暖原因.trim(),
    计划开始: draft.计划开始.trim(),
    计划恢复: draft.计划恢复.trim(),
    通知方式: draft.通知方式.trim(),
  }
  persist(rows)
  return { ok: true, message: `通知单 ${current.通知编号} 的拟稿内容已更新` }
}

/** 提交拟稿：待拟稿 → 待发布，同样只认本片区值班管理员。 */
export function submitNotice(id: number, ctx: OperatorContext): { ok: boolean; message: string } {
  const rows = loadNotices()
  const index = findIndex(rows, id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的停暖通知单` }
  }
  const current = rows[index]
  if (isLeader(ctx)) {
    return { ok: false, message: '越权操作已拒绝：提交拟稿是本片区值班管理员的职责，值班长不能代提交' }
  }
  if (!isSameDistrictAdmin(current, ctx)) {
    return { ok: false, message: `越权操作已拒绝：通知单 ${current.通知编号} 归属${current.拟稿人片区}，只有本片区值班管理员能提交` }
  }
  if (current.status === '已撤销') {
    return { ok: false, message: `通知单 ${current.通知编号} 已撤销整单只读，提交一律打回；请另起一条重新拟稿` }
  }
  if (current.status !== '待拟稿') {
    return { ok: false, message: `回退/重复提交已打回：通知单当前为「${current.status}」，只能从「待拟稿」提交` }
  }
  const invalid = validateDraft(current)
  if (invalid) {
    return { ok: false, message: invalid }
  }
  rows[index] = {
    ...current,
    status: '待发布',
    通知状态: '待发布',
    pending: true,
    提交时间: current.提交时间 || nowText(),
  }
  persist(rows)
  return { ok: true, message: `通知单 ${current.通知编号} 已提交，当前状态「待发布」，等待值班长发布` }
}

/** 发布：待发布 → 已发布，收口在值班长；重复提交只记一遍，不覆盖首发留痕。 */
export function publishNotice(id: number, ctx: OperatorContext): { ok: boolean; message: string } {
  const rows = loadNotices()
  const index = findIndex(rows, id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的停暖通知单` }
  }
  const current = rows[index]
  if (!isLeader(ctx)) {
    return { ok: false, message: '越权操作已拒绝：发布权收口在值班长，值班管理员只能拟稿' }
  }
  if (current.status === '已发布') {
    // 幂等：重复发布不再写一遍发布时间/发布人。
    return { ok: true, message: `通知单 ${current.通知编号} 已发布（发布人 ${current.发布人}，${current.发布时间}），重复提交只记一遍` }
  }
  if (current.status === '已撤销') {
    return { ok: false, message: `通知单 ${current.通知编号} 已撤销整单只读，发布一律打回` }
  }
  if (current.status !== '待发布') {
    return { ok: false, message: `越序发布已打回：通知单当前为「${current.status}」，只有「待发布」能发布，状态只能单向推进` }
  }
  rows[index] = {
    ...current,
    status: '已发布',
    通知状态: '已发布',
    pending: false,
    发布人: ctx.operator,
    发布时间: nowText(),
  }
  persist(rows)
  return { ok: true, message: `通知单 ${current.通知编号} 已由值班长 ${ctx.operator} 发布，对外按已发布口径通知` }
}

/** 撤销：已发布 → 已撤销，收口在值班长；撤销后整单只读，结果进入入户服务待补发清单。 */
export function revokeNotice(id: number, draft: RevokeDraft, ctx: OperatorContext): { ok: boolean; message: string } {
  const rows = loadNotices()
  const index = findIndex(rows, id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的停暖通知单` }
  }
  const current = rows[index]
  if (!isLeader(ctx)) {
    return { ok: false, message: '越权操作已拒绝：撤销权收口在值班长，值班管理员不能撤销通知' }
  }
  if (current.status === '已撤销') {
    return { ok: false, message: `通知单 ${current.通知编号} 已是「已撤销」，整单只读，不能重复撤销` }
  }
  if (current.status !== '已发布') {
    return { ok: false, message: `越序撤销已打回：通知单当前为「${current.status}」，只有「已发布」能撤销，状态只能单向推进` }
  }
  if (!draft.撤销原因.trim()) {
    return { ok: false, message: '撤销原因不能为空，请退回重填' }
  }
  rows[index] = {
    ...current,
    status: '已撤销',
    通知状态: '已撤销',
    pending: false,
    撤销人: ctx.operator,
    撤销时间: nowText(),
    撤销原因: draft.撤销原因.trim(),
  }
  persist(rows)
  return { ok: true, message: `通知单 ${current.通知编号} 已撤销并转只读，对外改按已撤销口径；撤销结果已进入入户服务待补发清单` }
}

/** 重新拟稿：不复活旧单，而是另起一条待拟稿新单，回指原撤销单。 */
export function redraftNotice(id: number, ctx: OperatorContext): { ok: boolean; message: string; id?: number } {
  const rows = loadNotices()
  const index = findIndex(rows, id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的停暖通知单` }
  }
  const source = rows[index]
  if (source.status !== '已撤销') {
    return { ok: false, message: `只有「已撤销」的通知单需要另起重拟，当前「${source.status}」不能走重新拟稿` }
  }
  if (!isSameDistrictAdmin(source, ctx)) {
    return { ok: false, message: `越权操作已拒绝：通知单 ${source.通知编号} 归属${source.拟稿人片区}，只有本片区值班管理员能另起重拟` }
  }
  const seq = rows.reduce((max, row) => Math.max(max, Number(row.id)), 0) + 1
  const year = new Date().getFullYear()
  const notice: HeatNotice = {
    id: seq,
    status: '待拟稿',
    pending: true,
    abnormal: false,
    通知编号: `TZ-${year}-${String(seq).padStart(4, '0')}`,
    影响片区: source.影响片区,
    停暖原因: source.停暖原因,
    计划开始: '',
    计划恢复: '',
    通知方式: source.通知方式,
    发布人: '',
    通知状态: '待拟稿',
    拟稿人: ctx.operator,
    拟稿人片区: ctx.district,
    提交时间: '',
    发布时间: '',
    撤销人: '',
    撤销时间: '',
    撤销原因: '',
    来源通知单: source.通知编号,
  }
  persist([...rows, notice])
  return {
    ok: true,
    message: `已另起新单 ${notice.通知编号}（待拟稿），原撤销单 ${source.通知编号} 保持只读；计划时间请重新填写`,
    id: notice.id,
  }
}

/**
 * 对外口径：列表与详情共用同一份。
 * 只有已发布、已撤销会对外；已撤销单不再按已发布口径，而是明确告知撤销。
 */
export function publicNotices(): PublicNotice[] {
  return loadNotices()
    .filter((row) => row.status === '已发布' || row.status === '已撤销')
    .map((row) => ({
      通知编号: row.通知编号,
      影响片区: row.影响片区,
      停暖原因: row.停暖原因,
      计划开始: row.计划开始,
      计划恢复: row.计划恢复,
      通知方式: row.通知方式,
      发布人: row.发布人,
      status: row.status,
      对外口径: row.status === '已发布' ? publishedWording(row) : revokedWording(row),
    }))
}

/** 入户服务待补发清单：由已撤销通知派生，撤销一发生这里就反映出来。 */
export function reissueItems(): ReissueItem[] {
  return loadNotices()
    .filter((row) => row.status === '已撤销')
    .map((row) => ({
      key: `补发-${row.通知编号}`,
      通知编号: row.通知编号,
      影响片区: row.影响片区,
      停暖原因: row.停暖原因,
      计划开始: row.计划开始,
      计划恢复: row.计划恢复,
      撤销人: row.撤销人,
      撤销时间: row.撤销时间,
      撤销原因: row.撤销原因,
      待补发: true as const,
    }))
}

export { STATUSES as NOTICE_STATUSES }
