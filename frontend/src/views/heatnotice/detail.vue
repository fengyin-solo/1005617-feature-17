<template>
  <section class="page" data-module="heatnotice-detail">
    <header class="page-head">
      <div>
        <h2>停暖通知详情</h2>
        <p class="page-desc">与通知列表走同一份取数，状态口径一致；撤销后的通知单整单只读。</p>
      </div>
      <div class="page-actions">
        <RouterLink class="btn" to="/heatnotice">返回列表</RouterLink>
      </div>
    </header>

    <template v-if="row">
      <p v-if="row.status === '已撤销'" class="error-text">该通知单已撤销，整单只读，不再对外变更。</p>
      <table class="data-table detail-table">
        <tbody>
          <tr v-for="field in fields" :key="field">
            <th>{{ field }}</th>
            <td>{{ row[field] === '' || row[field] === undefined ? '—' : row[field] }}</td>
          </tr>
          <tr>
            <th>当前状态</th>
            <td>{{ row.status }}</td>
          </tr>
        </tbody>
      </table>
    </template>
    <p v-else class="empty-state">没有找到该停暖通知单，可能已被重置，请返回列表确认。</p>

    <footer class="page-foot">
      <span>取数来源：本地数据层（与停暖通知列表同一份）</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useRoute } from 'vue-router'

import { getEntry } from '@/api/local-service'
import type { EntryRow } from '@/data/types'

const fields = ["通知编号", "影响片区", "停暖原因", "计划开始", "计划恢复", "通知方式", "发布人", "通知状态"]

const route = useRoute()
const row = ref<EntryRow | null>(null)

onMounted(() => {
  row.value = getEntry('heatnotice', Number(route.params.id))
})
</script>
