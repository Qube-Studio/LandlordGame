// 场景抓取信号（触屏相机拖拽让位用）：当玩家正用手指拖拽卡牌/协商钱牌时，
// 相机 swipe-转视角不抢手（否则一次触摸既拖牌又转视角，天旋地转）。
// HandLayer / PayoutLayer 在各自 useFrame 里按当前是否握着东西写 active（帧级刷新，
// 一帧延迟无感）；Scene3D 的触屏相机拖拽读它，active 时只更新锚点、不转视角。
export const grab = { active: false };
