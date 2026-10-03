// 业务规则冒烟验证：用最小 DOM 桩把 api/heat-notice.ts 的规则在 Node 里跑一遍。
// 不入库、不依赖构建，只校验「权限收口 / 单向状态机 / 非法值退回 / 幂等发布 / 撤销联动」。
import { pathToFileURL } from 'node:url'

const storage = new Map()
globalThis.window = {
  localStorage: {
    getItem: (k) => (storage.has(k) ? storage.get(k) : null),
    setItem: (k, v) => storage.set(k, v),
    removeItem: (k) => storage.delete(k),
  },
}

// 跳过 vue 无关模块：服务层只依赖 data 层，但 ts 需要即时编译，用 esbuild 已在依赖里。
import { build } from 'esbuild'
import { writeFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const rootDir = fileURLToPath(new URL('../', import.meta.url))
const result = await build({
  entryPoints: [join(rootDir, 'src/api/heat-notice.ts')],
  bundle: true,
  format: 'esm',
  platform: 'browser',
  write: false,
  alias: { '@': join(rootDir, 'src') },
})
const dir = mkdtempSync(join(tmpdir(), 'hn-'))
const out = join(dir, 'service.js')
writeFileSync(out, result.outputFiles[0].text)
const svc = await import(pathToFileURL(out).href)

const leader = { role: 'shift_leader', operator: '周敏', district: '' }
const chengdong = { role: 'duty_admin', operator: '李强', district: '城东片区' }
const chengxi = { role: 'duty_admin', operator: '王芳', district: '城西片区' }

let passed = 0
let failed = 0
function check(name, cond, detail = '') {
  if (cond) {
    passed += 1
    console.log(`  ✓ ${name}`)
  } else {
    failed += 1
    console.error(`  ✗ ${name} ${detail}`)
  }
}

// 1. 登记：只有片区值班管理员；影响片区强制取归属
let r = svc.createNotice(
  { 影响片区: '乱填片区', 停暖原因: '阀门更换', 计划开始: '2026-10-04 08:00', 计划恢复: '2026-10-04 18:00', 通知方式: '公告' },
  chengdong,
)
check('城东管理员登记成功', r.ok, r.message)
const newId = r.id
const created = svc.noticeById(newId)
check('影响片区强制收口为归属片区（表单乱填无效）', created.影响片区 === '城东片区', created.影响片区)
check('拟稿人归属留痕', created.拟稿人 === '李强' && created.拟稿人片区 === '城东片区')

r = svc.createNotice(
  { 影响片区: '城东片区', 停暖原因: 'x', 计划开始: '2026-10-04 08:00', 计划恢复: '2026-10-04 18:00', 通知方式: '公告' },
  leader,
)
check('值班长登记被拒（不拟稿）', !r.ok)

// 2. 非法计划恢复退回重填
r = svc.createNotice(
  { 影响片区: '城东片区', 停暖原因: '阀门更换', 计划开始: '2026-10-04 08:00', 计划恢复: '10月4号18点', 通知方式: '公告' },
  chengdong,
)
check('计划恢复格式非法退回', !r.ok && r.message.includes('计划恢复'))
r = svc.createNotice(
  { 影响片区: '城东片区', 停暖原因: '阀门更换', 计划开始: '2026-10-04 18:00', 计划恢复: '2026-10-04 08:00', 通知方式: '公告' },
  chengdong,
)
check('计划恢复早于计划开始退回', !r.ok && r.message.includes('晚于'))
r = svc.createNotice(
  { 影响片区: '城东片区', 停暖原因: '阀门更换', 计划开始: '2026-02-30 08:00', 计划恢复: '2026-10-04 18:00', 通知方式: '公告' },
  chengdong,
)
check('不存在的日期（2月30）退回', !r.ok && r.message.includes('计划开始'))

// 3. 越权改单：城西管理员改城东单被拒；值班长改单被拒
r = svc.updateNotice(newId,
  { 影响片区: '城西片区', 停暖原因: '被篡改', 计划开始: '2026-10-04 08:00', 计划恢复: '2026-10-04 18:00', 通知方式: '公告' },
  chengxi)
check('外片区管理员改单拒绝', !r.ok && r.message.includes('越权'))
r = svc.updateNotice(newId,
  { 影响片区: '城东片区', 停暖原因: '被篡改', 计划开始: '2026-10-04 08:00', 计划恢复: '2026-10-04 18:00', 通知方式: '公告' },
  leader)
check('值班长改单拒绝', !r.ok && r.message.includes('越权'))

// 本片区管理员可改，且影响片区即使随表提交也保持锁定
r = svc.updateNotice(newId,
  { 影响片区: '想改片区', 停暖原因: '一次网阀门更换', 计划开始: '2026-10-04 09:00', 计划恢复: '2026-10-04 18:00', 通知方式: '公告+短信' },
  chengdong)
check('本片区管理员待拟稿可改', r.ok)
check('影响片区改单后仍锁定', svc.noticeById(newId).影响片区 === '城东片区')

// 4. 提交：外片区/值班长拒绝
r = svc.submitNotice(newId, chengxi)
check('外片区提交拒绝', !r.ok)
r = svc.submitNotice(newId, leader)
check('值班长提交拒绝', !r.ok)
r = svc.submitNotice(newId, chengdong)
check('本片区提交待发布成功', r.ok && svc.noticeById(newId).status === '待发布')

// 5. 待发布后改单/再提交一律打回（不回退）
r = svc.updateNotice(newId,
  { 影响片区: '城东片区', 停暖原因: 'x', 计划开始: '2026-10-04 09:00', 计划恢复: '2026-10-04 18:00', 通知方式: '公告' },
  chengdong)
check('待发布后改单打回（锁定）', !r.ok)
r = svc.submitNotice(newId, chengdong)
check('待发布后重复提交打回', !r.ok)

// 6. 发布收口值班长；管理员发布拒绝
r = svc.publishNotice(newId, chengdong)
check('管理员发布拒绝', !r.ok && r.message.includes('值班长'))
r = svc.publishNotice(newId, leader)
check('值班长发布成功', r.ok && svc.noticeById(newId).status === '已发布')
const firstPublishTime = svc.noticeById(newId).发布时间
const firstPublisher = svc.noticeById(newId).发布人

// 7. 重复提交发布只记一遍
await new Promise((resolve) => setTimeout(resolve, 1200))
r = svc.publishNotice(newId, leader)
check('重复发布幂等返回 ok', r.ok && r.message.includes('只记一遍'))
const again = svc.noticeById(newId)
check('重复发布不覆盖首发人与首发时间', again.发布时间 === firstPublishTime && again.发布人 === firstPublisher)

// 8. 已发布后不能改回待拟稿（回退打回）；发布后改单拒绝
r = svc.updateNotice(newId,
  { 影响片区: '城东片区', 停暖原因: '想回改', 计划开始: '2026-10-04 09:00', 计划恢复: '2026-10-04 18:00', 通知方式: '公告' },
  chengdong)
check('已发布后改单拒绝', !r.ok)

// 9. 撤销收口值班长；管理员拒绝；撤销需原因
r = svc.revokeNotice(newId, { 撤销原因: '' }, leader)
check('撤销原因空被拒', !r.ok)
r = svc.revokeNotice(newId, { 撤销原因: '抢修提前完成' }, chengdong)
check('管理员撤销拒绝', !r.ok)
r = svc.revokeNotice(newId, { 撤销原因: '抢修提前完成' }, leader)
check('值班长撤销成功', r.ok && svc.noticeById(newId).status === '已撤销')

// 10. 撤销后整单只读：改/提交/发布/再撤销全部拒绝
const revokedId = newId
check('撤销后改单拒绝且提示另起', !svc.updateNotice(revokedId,
  { 影响片区: '城东片区', 停暖原因: 'a', 计划开始: '2026-10-04 09:00', 计划恢复: '2026-10-04 18:00', 通知方式: '公告' },
  chengdong).ok)
check('撤销后提交拒绝', !svc.submitNotice(revokedId, chengdong).ok)
check('撤销后发布拒绝', !svc.publishNotice(revokedId, leader).ok)
check('撤销后重复撤销拒绝', !svc.revokeNotice(revokedId, { 撤销原因: 'x' }, leader).ok)

// 11. 重新拟稿另起一条：旧单不动仍只读，新单待拟稿并回指来源
r = svc.redraftNotice(revokedId, chengxi)
check('外片区重拟拒绝', !r.ok)
r = svc.redraftNotice(revokedId, leader)
check('值班长重拟拒绝（不拟稿）', !r.ok)
const before = svc.notices().length
r = svc.redraftNotice(revokedId, chengdong)
check('本片区重拟成功另起一条', r.ok && typeof r.id === 'number')
check('总条数 +1，旧单仍在', svc.notices().length === before + 1 && svc.noticeById(revokedId).status === '已撤销')
const redrafted = svc.noticeById(r.id)
check('新单为待拟稿且回指来源单号', redrafted.status === '待拟稿' && redrafted.来源通知单 === svc.noticeById(revokedId).通知编号)
check('新单计划时间留空要求重填', redrafted.计划开始 === '' && redrafted.计划恢复 === '')

// 12. 对外口径：列表/详情同一份；撤销单不按已发布口径
const pub = svc.publicNotices()
const pubItem = pub.find((p) => p.通知编号 === svc.noticeById(revokedId).通知编号)
check('撤销单对外为已撤销口径', pubItem.status === '已撤销' && pubItem.对外口径.includes('已撤销'))
check('撤销单口径不再含发布停暖措辞', !pubItem.对外口径.includes('暂停供热，发布人'))
const stillPublished = pub.find((p) => p.通知编号 === 'TZ-2026-0003')
check('其它已发布单仍按发布口径', !!stillPublished && stillPublished.对外口径.includes('暂停供热'))

// 13. 撤销结果反映到入户服务待补发清单
const items = svc.reissueItems()
check('待补发清单含本次撤销单', items.some((i) => i.通知编号 === svc.noticeById(revokedId).通知编号 && i.待补发 === true))
check('待补发清单含种子撤销单 TZ-2026-0004', items.some((i) => i.通知编号 === 'TZ-2026-0004'))

// 14. 跨片跳序：直接发布一张待拟稿单被拒（无论谁操作，状态机只允许单向推进）
const draft = svc.notices().find((n) => n.status === '待拟稿')
check('待拟稿直接发布被拒（必须单向推进）', !!draft && !svc.publishNotice(draft.id, leader).ok)
check('已发布单直接重拟被拒（只有已撤销可另起重拟）', !svc.redraftNotice(3, chengdong).ok)

console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
