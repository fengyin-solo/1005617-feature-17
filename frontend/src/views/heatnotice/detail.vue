<template>
  <section class="page detail-page" data-module="heatnotice-detail">
    <header class="page-head">
      <div>
        <h2>停暖通知单详情</h2>
        <p class="page-desc">本页与通知列表走同一份取数；状态单向推进，撤销后整单只读，重新拟稿另起一条。</p>
      </div>
      <div class="page-actions">
        <RouterLink class="btn ghost" to="/heatnotice">返回通知列表</RouterLink>
      </div>
    </header>

    <div v-if="!notice" class="data-table empty-state">没有找到这张停暖通知单，可能已被重置或编号非法。</div>

    <template v-else>
      <div class="detail-head">
        <h3>{{ notice.通知编号 }}</h3>
        <span :class="['status-tag', `status-${notice.status}`]">{{ notice.status }}</span>
        <span v-if="notice.status === '已撤销'" class="readonly-flag">整单只读</span>
      </div>

      <table class="data-table detail-table">
        <tbody>
          <tr v-for="field in fields" :key="field">
            <th>{{ field }}</th>
            <td>{{ cellText(field) || '—' }}</td>
          </tr>
          <tr><th>当前状态</th><td>{{ notice.status }}</td></tr>
          <tr><th>拟稿人</th><td>{{ notice.拟稿人 }}（归属：{{ notice.拟稿人片区 }}）</td></tr>
          <tr><th>提交时间</th><td>{{ notice.提交时间 || '—' }}</td></tr>
          <tr><th>发布人 / 发布时间</th><td>{{ notice.发布人 ? `${notice.发布人} / ${notice.发布时间}` : '—' }}</td></tr>
          <tr><th>撤销人 / 撤销时间</th><td>{{ notice.撤销人 ? `${notice.撤销人} / ${notice.撤销时间}` : '—' }}</td></tr>
          <tr><th>撤销原因</th><td>{{ notice.撤销原因 || '—' }}</td></tr>
          <tr v-if="notice.来源通知单"><th>重拟来源</th><td>本单由已撤销的 {{ notice.来源通知单 }} 另起重拟</td></tr>
        </tbody>
      </table>

      <section class="public-block">
        <h3>对外通知口径</h3>
        <p v-if="publicRow" :class="['public-item', `status-${publicRow.status}`]">{{ publicRow.对外口径 }}</p>
        <p v-else class="muted-text">该单尚未发布，对外暂不展示任何停暖口径。</p>
      </section>

      <div class="detail-actions">
        <button v-if="canEdit(notice, ctx)" class="btn" type="button" @click="openEdit">修改拟稿</button>
        <button v-if="canSubmit(notice, ctx)" class="btn" type="button" @click="doSubmit">提交拟稿</button>
        <button v-if="canPublish(notice, ctx)" class="btn primary" type="button" @click="doPublish">发布通知</button>
        <button v-if="canRevoke(notice, ctx)" class="btn danger" type="button" @click="doRevoke">撤销通知</button>
        <button v-if="canRedraft(notice, ctx)" class="btn primary" type="button" @click="doRedraft">重新拟稿（另起一条）</button>
        <span v-if="availableCount === 0" class="muted-text">当前身份（{{ store.profile.label }}）对该单无可用动作；已撤销单只读，需要改动请用本片区值班管理员身份另起重拟。</span>
      </div>

      <footer class="page-foot">
        <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
        <span v-else-if="successMessage" class="success-text">{{ successMessage }}</span>
      </footer>

      <NoticeForm
        v-model:message="formMessage"
        :open="formOpen"
        :title="`修改拟稿 ${notice.通知编号}（${notice.影响片区}）`"
        :district="notice.影响片区"
        :initial="formInitial"
        @close="formOpen = false"
        @submit="onFormSubmit"
      />
    </template>
  </section>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'

import {
  canEdit,
  canPublish,
  canRedraft,
  canRevoke,
  canSubmit,
  noticeById,
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

const route = useRoute()
const router = useRouter()
const store = useSessionStore()

const fields: (keyof HeatNotice)[] = ['通知编号', '影响片区', '停暖原因', '计划开始', '计划恢复', '通知方式', '发布人']

const notice = ref<HeatNotice | null>(null)
const errorMessage = ref('')
const successMessage = ref('')
const formOpen = ref(false)
const formMessage = ref('')
const formInitial = ref<NoticeDraft | null>(null)

const id = computed(() => Number(route.params.id))
const ctx = computed<OperatorContext>(() => ({
  role: store.role,
  operator: store.operator,
  district: store.district,
}))

const publicRow = computed(() =>
  notice.value ? publicNotices().find((item) => item.通知编号 === notice.value!.通知编号) ?? null : null,
)

const availableCount = computed(() => {
  if (!notice.value) {
    return 0
  }
  return [
    canEdit(notice.value, ctx.value),
    canSubmit(notice.value, ctx.value),
    canPublish(notice.value, ctx.value),
    canRevoke(notice.value, ctx.value),
    canRedraft(notice.value, ctx.value),
  ].filter(Boolean).length
})

function reload() {
  errorMessage.value = ''
  successMessage.value = ''
  notice.value = noticeById(id.value)
}

function cellText(field: keyof HeatNotice): string {
  if (!notice.value) {
    return ''
  }
  const value = notice.value[field]
  return typeof value === 'string' ? value : String(value ?? '')
}

function openEdit() {
  if (!notice.value) {
    return
  }
  formInitial.value = {
    影响片区: notice.value.影响片区,
    停暖原因: notice.value.停暖原因,
    计划开始: notice.value.计划开始,
    计划恢复: notice.value.计划恢复,
    通知方式: notice.value.通知方式,
  }
  formMessage.value = ''
  formOpen.value = true
}

function onFormSubmit(draft: NoticeDraft) {
  if (!notice.value) {
    return
  }
  const result = updateNotice(notice.value.id, draft, ctx.value)
  if (!result.ok) {
    formMessage.value = result.message
    return
  }
  formOpen.value = false
  successMessage.value = result.message
  reload()
}

function doSubmit() {
  if (!notice.value) {
    return
  }
  const result = submitNotice(notice.value.id, ctx.value)
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  successMessage.value = result.message
  reload()
}

function doPublish() {
  if (!notice.value) {
    return
  }
  // 重复提交发布只记一遍：服务端对已发布单做幂等返回，这里不会再写第二遍。
  const result = publishNotice(notice.value.id, ctx.value)
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  successMessage.value = result.message
  reload()
}

function doRevoke() {
  if (!notice.value) {
    return
  }
  const reason = window.prompt(`撤销通知单 ${notice.value.通知编号} 需填写撤销原因（撤销后整单转只读，撤销结果进入入户服务待补发清单）：`)
  if (reason === null) {
    return
  }
  const result = revokeNotice(notice.value.id, { 撤销原因: reason }, ctx.value)
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  successMessage.value = result.message
  reload()
}

function doRedraft() {
  if (!notice.value) {
    return
  }
  const result = redraftNotice(notice.value.id, ctx.value)
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  if (result.id !== undefined) {
    router.push(`/heatnotice/${result.id}`)
  }
}

watch(id, reload, { immediate: true })
// 切换在岗身份后，按身份重新判定可用动作。
watch(() => [store.profileIndex, store.role, store.district], reload)
</script>
