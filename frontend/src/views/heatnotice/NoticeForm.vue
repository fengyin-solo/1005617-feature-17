<template>
  <div v-if="open" class="modal-mask" @click.self="close">
    <div class="modal-card">
      <header class="modal-head">
        <h3>{{ title }}</h3>
        <button class="link" type="button" @click="close">关闭</button>
      </header>
      <form class="modal-body" @submit.prevent="save">
        <label class="form-item">
          <span>影响片区（归属，登记后锁定）</span>
          <input :value="district" disabled />
        </label>
        <label class="form-item">
          <span>停暖原因</span>
          <input v-model="form.停暖原因" placeholder="如：一次网主管阀门更换" />
        </label>
        <label class="form-item">
          <span>计划开始（YYYY-MM-DD HH:mm）</span>
          <input v-model="form.计划开始" placeholder="2026-10-04 08:00" />
        </label>
        <label class="form-item">
          <span>计划恢复（YYYY-MM-DD HH:mm，须晚于计划开始）</span>
          <input v-model="form.计划恢复" placeholder="2026-10-04 18:00" />
        </label>
        <label class="form-item">
          <span>通知方式</span>
          <input v-model="form.通知方式" placeholder="如：片区公告+短信" />
        </label>
        <p v-if="message" class="error-text">{{ message }}</p>
        <footer class="modal-foot">
          <button class="btn" type="button" @click="close">取消</button>
          <button class="btn primary" type="submit">保存</button>
        </footer>
      </form>
    </div>
  </div>
</template>

<script setup lang="ts">
import { reactive, watch } from 'vue'

import type { NoticeDraft } from '@/data/types'

const props = defineProps<{
  open: boolean
  title: string
  district: string
  initial?: NoticeDraft | null
}>()

const emit = defineEmits<{
  (e: 'close'): void
  (e: 'submit', draft: NoticeDraft): void
}>()

const empty: NoticeDraft = { 影响片区: '', 停暖原因: '', 计划开始: '', 计划恢复: '', 通知方式: '' }

const form = reactive<NoticeDraft>({ ...empty })
const message = defineModel<string>('message')

watch(
  () => [props.open, props.initial],
  () => {
    if (props.open) {
      Object.assign(form, empty, props.initial ?? {})
      message.value = ''
    }
  },
  { immediate: true },
)

function close() {
  emit('close')
}

function save() {
  emit('submit', {
    影响片区: props.district,
    停暖原因: form.停暖原因,
    计划开始: form.计划开始,
    计划恢复: form.计划恢复,
    通知方式: form.通知方式,
  })
}
</script>
