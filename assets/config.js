/* 船员学习室 · 配置文件
 *
 * 这里只放"可以公开"的东西。
 * Supabase 的 anon key 设计上就是给前端用的（安全感来自数据库的 RLS 行级权限），
 * 所以它可以明文放在这里。
 *
 * ⚠️ 但密码、密钥（service_role key）绝对不能写进这个文件。
 *
 * 没填下面两个值也能用：会以「本机模式」运行，数据存在当前设备的浏览器里，
 * 适合先试手感。想让手机和电脑同步，就按《部署与配置指南.md》填上这两个值，
 * 然后把 syncMode 改成 'cloud'。 */

window.CY_CONFIG = {
  syncMode: 'cloud',                          // ← local 改成 cloud
  supabaseUrl: 'https://ptucxzuyypaczyqhuhjl.supabase.co',    // ← 粘 Project URL
  supabaseAnonKey: 'sb_publishable_33e9bczajy9riQC4fkHWvg_zWT6exaQ'      // ← 粘 Publishable key
};