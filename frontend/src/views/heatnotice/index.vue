<template>
  <section class="page" data-module="heatnotice">
    <header class="page-head">
      <div>
        <h2>停暖通知管理</h2>
        <p class="page-desc">拟稿归属本片区值班管理员，发布与撤销收口在值班长；待拟稿→待发布→已发布→已撤销单向推进，撤销后整单只读、重新拟稿另起一条。</p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="openCreate">登记停暖通知单</button>
        <button class="btn" type="button" @click="exportRows">导出停暖通知清单</button>
      </div>
    </header>

    <div class="stat-row">
      <article v-for="item in stats" :key="item.label" class="stat-card">
        <span class="stat-label">{{ item.label }}</span>
        <strong class="stat-value">{{ item.value }}</strong>
      </article>
    </div>

    <p class="status-legend">
      <span v-for="item in statusSummary" :key="item.status" class="legend-item">
        {{ item.status }}：{{ item.count }}
      </span>
    </p>

    <form class="filter-bar" @submit.prevent="reload">
      <label v-for="field in filterFields" :key="field" class="filter-item">
        <span>{{ field }}</span>
        <input v-model="filters[field]" :placeholder="`按${field}检索`" />
      </label>
      <button class="btn" type="submit">查询</button>
      <button class="btn ghost" type="button" @click="resetFilters">重置条件</button>
    </form>

    <table class="data-table">
      <thead>
        <tr>
          <th v-for="column in columns" :key="column">{{ column }}</th>
          <th>当前状态</th>
          <th>归属/留痕</th>
          <th>可执行动作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="String(row.id)">
          <td v-for="column in columns" :key="column">
            <RouterLink v-if="column === '通知编号'" class="link" :to="`/heatnotice/${row.id}`">{{ cellText(row, column) }}</RouterLink>
            <span v-else>{{ cellText(row, column) || '—' }}</span>
          </td>
          <td>
            <span :class="['status-tag', `status-${row.status}`]">{{ row.status }}</span>
          </td>
          <td class="trace-cell">
            拟稿：{{ row.拟稿人 }}（{{ row.拟稿人片区 }}）<br />
            <template v-if="row.发布人">发布：{{ row.发布人 }} {{ row.发布时间 }}</template>
            <template v-if="row.撤销人"><br />撤销：{{ row.撤销人 }} {{ row.撤销时间 }}</template>
          </td>
          <td class="row-actions">
            <template v-for="action in actionsFor(row)" :key="action.label">
              <button class="link" type="button" @click="runAction(action, row)">{{ action.label }}</button>
            </template>
            <span v-if="actionsFor(row).length === 0" class="muted-text">当前身份无可用动作</span>
          </td>
        </tr>
        <tr v-if="!rows.length">
          <td :colspan="columns.length + 3" class="empty-state">暂无停暖通知数据，可先登记停暖通知单</td>
        </tr>
      </tbody>
    </table>

    <section class="public-block">
      <h3>对外通知口径（与详情页同一份取数）</h3>
      <p class="page-desc">仅已发布、已撤销单对外；已撤销单不再按原发布口径，改按已撤销口径告知。</p>
      <ul class="public-list">
        <li v-for="item in publicRows" :key="item.通知编号" :class="['public-item', `status-${item.status}`]">
          <span class="status-tag">{{ item.status }}</span>
          {{ item.对外口径 }}
        </li>
        <li v-if="!publicRows.length" class="muted-text">暂无可对外的停暖通知</li>
      </ul>
    </section>

    <footer class="page-foot">
      <span>共 {{ total }} 条停暖通知记录</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>

    <NoticeForm
      v-model:message="formMessage"
      :open="formOpen"
      :title="formTitle"
      :district="store.district"
      :initial="formInitial"
      @close="formOpen = false"
      @submit="onFormSubmit"
    />
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'

import { downloadEntries, moduleMeta } from '@/api/local-service'
import {
  canCreate,
  canEdit,
  canPublish,
  canRedraft,
  canRevoke,
  canSubmit,
  createNotice,
  notices,
  publicNotices,
  publishNotice,
  redraftNotice,
  revokeNotice,
  submitNotice,
  updateNotice,
} from '@/api/heat-notice'
import { useSessionStore } from '@/stores/session'
import type { HeatNotice, NoticeDraft, OperatorContext } from '@/data/types'
import NoticeForm from './NoticeForm.vue'

const meta = moduleMeta('heatnotice')
const store = useSessionStore()
const columns: (keyof HeatNotice)[] = ['通知编号', '影响片区', '停暖原因', '计划开始', '计划恢复', '通知方式']
const statuses = ['待拟稿', '待发布', '已发布', '已撤销']

const rows = ref<HeatNotice[]>([])
const total = ref(0)
const errorMessage = ref('')
const filters = ref<Record<string, string>>({})
const filterFields: string[] = ['通知编号', '影响片区', '停暖原因']
const publicRows = ref(publicNotices())

function cellText(row: HeatNotice, column: keyof HeatNotice): string {
  const value = row[column]
  return typeof value === 'string' ? value : String(value ?? '')
}

const formOpen = ref(false)
const formMessage = ref('')
const formTitle = ref('')
const formInitial = ref<NoticeDraft | null>(null)
const formMode = ref<'create' | 'edit'>('create')
const editingId = ref(0)

const ctx = computed<OperatorContext>(() => ({
  role: store.role,
  operator: store.operator,
  district: store.district,
}))

const stats = computed(() => {
  const published = rows.value.filter((row) => row.status === '已发布')
  return [
    { label: '待发布通知', value: rows.value.filter((row) => row.status === '待发布').length },
    { label: '已发布通知', value: published.length },
    { label: '影响片区数', value: new Set(published.map((row) => row.影响片区)).size },
  ]
})

const statusSummary = computed(() =>
  statuses.map((status) => ({
    status,
    count: rows.value.filter((row) => row.status === status).length,
  })),
)

type RowAction = { key: string; label: string }

function actionsFor(row: HeatNotice): RowAction[] {
  const list: RowAction[] = []
  if (canEdit(row, ctx.value)) {
    list.push({ key: 'edit', label: '修改拟稿' })
  }
  if (canSubmit(row, ctx.value)) {
    list.push({ key: 'submit', label: '提交拟稿' })
  }
  if (canPublish(row, ctx.value)) {
    list.push({ key: 'publish', label: '发布通知' })
  }
  if (canRevoke(row, ctx.value)) {
    list.push({ key: 'revoke', label: '撤销通知' })
  }
  if (canRedraft(row, ctx.value)) {
    list.push({ key: 'redraft', label: '重新拟稿（另起一条）' })
  }
  return list
}

function resetFilters() {
  filters.value = {}
  reload()
}

function exportRows() {
  downloadEntries(meta.key)
}

function openCreate() {
  if (!canCreate(ctx.value)) {
    errorMessage.value = '越权操作已拒绝：只有本片区值班管理员能登记停暖通知单；如需拟稿请切换到对应片区的值班管理员身份'
    return
  }
  formMode.value = 'create'
  formTitle.value = `登记停暖通知单（${store.district}）`
  formInitial.value = { 影响片区: store.district, 停暖原因: '', 计划开始: '', 计划恢复: '', 通知方式: '' }
  formMessage.value = ''
  formOpen.value = true
}

function openEdit(row: HeatNotice) {
  formMode.value = 'edit'
  editingId.value = row.id
  formTitle.value = `修改拟稿 ${row.通知编号}（${row.影响片区}）`
  formInitial.value = {
    影响片区: row.影响片区,
    停暖原因: row.停暖原因,
    计划开始: row.计划开始,
    计划恢复: row.计划恢复,
    通知方式: row.通知方式,
  }
  formMessage.value = ''
  formOpen.value = true
}

function onFormSubmit(draft: NoticeDraft) {
  const result =
    formMode.value === 'create'
      ? createNotice(draft, ctx.value)
      : updateNotice(editingId.value, draft, ctx.value)
  formMessage.value = result.ok ? '' : result.message
  if (!result.ok) {
    return
  }
  errorMessage.value = ''
  formOpen.value = false
  reload()
}

function runAction(action: RowAction, row: HeatNotice) {
  errorMessage.value = ''
  if (action.key === 'edit') {
    openEdit(row)
    return
  }
  if (action.key === 'redraft') {
    const result = redraftNotice(row.id, ctx.value)
    if (result.ok) {
      reload()
    } else {
      errorMessage.value = result.message
    }
    return
  }
  if (action.key === 'revoke') {
    const reason = window.prompt(`撤销通知单 ${row.通知编号} 需填写撤销原因（撤销后整单转只读，撤销结果进入入户服务待补发清单）：`)
    if (reason === null) {
      return
    }
    const result = revokeNotice(row.id, { 撤销原因: reason }, ctx.value)
    if (!result.ok) {
      errorMessage.value = result.message
      return
    }
    reload()
    return
  }
  const result =
    action.key === 'submit'
      ? submitNotice(row.id, ctx.value)
      : action.key === 'publish'
        ? publishNotice(row.id, ctx.value)
        : { ok: false, message: `没有登记「${action.label}」这个动作` }
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  reload()
}

function reload() {
  errorMessage.value = ''
  try {
    const matched = notices(filters.value)
    rows.value = matched
    total.value = matched.length
    publicRows.value = publicNotices()
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '停暖通知列表读取失败'
  }
}

onMounted(reload)

// 顶栏切换在岗身份后，按当前身份重新收口动作与统计。
watch(
  () => [store.role, store.district],
  () => reload(),
)
</script>
