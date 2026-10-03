<template>
  <section class="page" data-module="heatnotice">
    <header class="page-head">
      <div>
        <h2>停暖通知管理</h2>
        <p class="page-desc">维护停暖通知单，围绕通知编号、影响片区、停暖原因、计划开始做登记、筛选与状态流转。</p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="openCreate">登记停暖通知单</button>
        <button class="btn" type="button" @click="exportRows">导出停暖通知清单</button>
      </div>
    </header>

    <p class="duty-hint">
      当前身份：{{ session.role }} · {{ session.area }}。拟稿与修改限本片区值班管理员，发布与撤销限值班长；
      流程按待拟稿→待发布→已发布→已撤销单向推进，撤销后整单只读，重新拟稿请另起一条。
    </p>

    <form v-if="formVisible" class="notice-form" @submit.prevent="submitForm">
      <label class="filter-item">
        <span>影响片区（仅本片区）</span>
        <input v-model="form.影响片区" readonly />
      </label>
      <label class="filter-item">
        <span>停暖原因</span>
        <input v-model="form.停暖原因" placeholder="必填" />
      </label>
      <label class="filter-item">
        <span>计划开始</span>
        <input v-model="form.计划开始" type="date" />
      </label>
      <label class="filter-item">
        <span>计划恢复</span>
        <input v-model="form.计划恢复" type="date" />
      </label>
      <label class="filter-item">
        <span>通知方式</span>
        <input v-model="form.通知方式" placeholder="如 短信+公告栏" />
      </label>
      <button class="btn primary" type="submit">{{ editingId === null ? '保存拟稿' : '保存修改' }}</button>
      <button class="btn ghost" type="button" @click="closeForm">取消</button>
    </form>

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
          <th>可执行动作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="String(row.id)">
          <td v-for="column in columns" :key="column">{{ row[column] ?? '—' }}</td>
          <td>{{ row.status }}</td>
          <td class="row-actions">
            <RouterLink class="link" :to="`/heatnotice/detail/${row.id}`">详情</RouterLink>
            <button class="link" type="button" @click="openEdit(row)">修改</button>
            <button
              v-for="action in actions"
              :key="action"
              class="link"
              type="button"
              @click="runAction(action, row)"
            >
              {{ action }}
            </button>
          </td>
        </tr>
        <tr v-if="!rows.length">
          <td :colspan="columns.length + 2" class="empty-state">暂无停暖通知数据，可先登记停暖通知单</td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>共 {{ total }} 条停暖通知记录</span>
      <span v-if="infoMessage" class="info-text">{{ infoMessage }}</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import {
  downloadEntries,
  listEntries,
  moduleMeta,
  runNoticeAction,
  saveNoticeDraft,
} from '@/api/local-service'
import type { EntryRow, OperatorContext } from '@/data/types'
import { useSessionStore } from '@/stores/session'

const meta = moduleMeta('heatnotice')
const session = useSessionStore()
const columns = ["通知编号", "影响片区", "停暖原因", "计划开始", "计划恢复", "通知方式", "发布人", "通知状态"]
const actions = ["提交拟稿", "发布通知", "撤销通知"]
const statuses = ["待拟稿", "待发布", "已发布", "已撤销"]
const stats = [{"label": "待发布通知", "value": 0}, {"label": "已发布通知", "value": 0}, {"label": "影响片区数", "value": 0}]

const rows = ref<EntryRow[]>([])
const total = ref(0)
const errorMessage = ref('')
const infoMessage = ref('')
const filters = ref<Record<string, string>>({})
const filterFields = columns.slice(0, 3)
const statusSummary = computed(() =>
  statuses.map((status: string) => ({
    status,
    count: rows.value.filter((row) => String(row.status) === status).length,
  })),
)

const formVisible = ref(false)
const editingId = ref<number | null>(null)
const blankForm = () => ({
  影响片区: session.area,
  停暖原因: '',
  计划开始: '',
  计划恢复: '',
  通知方式: '',
})
const form = ref(blankForm())

function operatorContext(): OperatorContext {
  return { operator: session.operator, role: session.role, area: session.area }
}

function resetFilters() {
  filters.value = {}
  reload()
}

function exportRows() {
  downloadEntries(meta.key)
}

function openCreate() {
  editingId.value = null
  form.value = blankForm()
  formVisible.value = true
  errorMessage.value = ''
  infoMessage.value = ''
}

function openEdit(row: EntryRow) {
  editingId.value = Number(row.id)
  form.value = {
    影响片区: String(row['影响片区'] ?? session.area),
    停暖原因: String(row['停暖原因'] ?? ''),
    计划开始: String(row['计划开始'] ?? ''),
    计划恢复: String(row['计划恢复'] ?? ''),
    通知方式: String(row['通知方式'] ?? ''),
  }
  formVisible.value = true
  errorMessage.value = ''
  infoMessage.value = ''
}

function closeForm() {
  formVisible.value = false
}

function submitForm() {
  errorMessage.value = ''
  infoMessage.value = ''
  const result = saveNoticeDraft(
    { id: editingId.value ?? undefined, ...form.value },
    operatorContext(),
  )
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  formVisible.value = false
  reload()
  infoMessage.value = result.message
}

function runAction(action: string, row: EntryRow) {
  errorMessage.value = ''
  infoMessage.value = ''
  const result = runNoticeAction(Number(row.id), action, operatorContext())
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  reload()
  infoMessage.value = result.message
}

function reload() {
  errorMessage.value = ''
  try {
    const payload = listEntries(meta.key, filters.value)
    rows.value = payload.items
    total.value = payload.total
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '停暖通知列表读取失败'
  }
}

onMounted(reload)
</script>
