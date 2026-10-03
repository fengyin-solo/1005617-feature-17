import { defineStore } from 'pinia'

export type SessionRole = 'shift_leader' | 'duty_admin'

export type SessionProfile = {
  role: SessionRole
  /** 值班人员姓名（会写进拟稿人/发布人，归属到人） */
  operator: string
  /** 值班管理员的归属片区；值班长跨片区，为空串 */
  district: string
  /** 顶栏身份切换里展示的说明 */
  label: string
}

// 演示用的三套在岗身份：一个值班长（发布/撤销收口），两个片区各自的值班管理员（拟稿收口）。
export const SESSION_PROFILES: SessionProfile[] = [
  { role: 'shift_leader', operator: '周敏', district: '', label: '值班长·周敏（发布/撤销，跨片区）' },
  { role: 'duty_admin', operator: '李强', district: '城东片区', label: '城东片区·值班管理员 李强（仅本片区拟稿）' },
  { role: 'duty_admin', operator: '王芳', district: '城西片区', label: '城西片区·值班管理员 王芳（仅本片区拟稿）' },
]

export const useSessionStore = defineStore('session', {
  state: () => ({
    profileIndex: 0,
    shiftLabel: '白班 08:00-20:00',
    scope: '城市集中供热管网与换热站运行管理平台',
  }),
  getters: {
    profile(state): SessionProfile {
      return SESSION_PROFILES[state.profileIndex] ?? SESSION_PROFILES[0]
    },
    role(): SessionRole {
      return this.profile.role
    },
    operator(): string {
      return this.profile.operator
    },
    /** 归属片区：值班管理员为本片区，值班长为空（不归属任何片区） */
    district(): string {
      return this.profile.district
    },
    isLeader(): boolean {
      return this.profile.role === 'shift_leader'
    },
    isAdmin(): boolean {
      return this.profile.role === 'duty_admin'
    },
    canOperate(): boolean {
      return this.profile.operator.length > 0
    },
  },
  actions: {
    switchProfile(index: number) {
      if (index >= 0 && index < SESSION_PROFILES.length) {
        this.profileIndex = index
      }
    },
    setShift(label: string) {
      this.shiftLabel = label
    },
  },
})
