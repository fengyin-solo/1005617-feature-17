import { defineStore } from 'pinia'

import type { OperatorRole } from '@/data/types'

// 值班片区：停暖通知单按片区归属，值班管理员只能动本片区的单子。
export const DUTY_AREAS = ['城东片区', '城西片区', '城北片区']
export const OPERATOR_ROLES: OperatorRole[] = ['值班管理员', '值班长']

export const useSessionStore = defineStore('session', {
  state: () => ({
    operator: '李卫',
    role: '值班管理员' as OperatorRole,
    area: DUTY_AREAS[0],
    shiftLabel: '白班 08:00-20:00',
    scope: '城市集中供热管网与换热站运行管理平台',
  }),
  getters: {
    canOperate: (state) => state.operator.length > 0,
    isChief: (state) => state.role === '值班长',
  },
  actions: {
    setShift(label: string) {
      this.shiftLabel = label
    },
    setRole(role: OperatorRole) {
      this.role = role
    },
    setArea(area: string) {
      this.area = area
    },
  },
})
