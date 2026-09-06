/**
 * 下载精选 Live2D Q版模型到项目 models/（随安装包发货）
 *
 * 使用部分克隆的 git 仓库来按需提取模型文件
 */
const fs = require('fs')
const path = require('path')
const { execSync } = require('child_process')

const REPO = path.join(__dirname, 'models', '_repo')
const DEST = path.join(__dirname, 'models')

// ── 精选模型列表 ──────────────────────────────────
// 每个条目: { name: 目标目录名, source: 源仓库路径 }
const SELECTED_MODELS = [
  // ═══ Fox Hime Zero — 85个动画，最佳桌面宠物 ═══
  { name: 'mori-miko',     source: 'galgame live2d/Fox Hime Zero/mori_miko',     desc: '森美子 — 狐娘巫女 (85动画)' },
  { name: 'ruri-miko',     source: 'galgame live2d/Fox Hime Zero/ruri_miko',     desc: '瑠璃美子 — 狐娘巫女 (85动画)' },
  { name: 'mori-suit',     source: 'galgame live2d/Fox Hime Zero/mori_suit',     desc: '森美子 — 便服版 (85动画)' },

  // ═══ 为美好的世界献上祝福 — Q版角色 ═══
  { name: 'konosuba-001',  source: '为美好的世界献上祝福！Fantastic Days/1004100',   desc: '美好世界角色1 (38动画)' },
  { name: 'konosuba-aqua', source: '为美好的世界献上祝福！Fantastic Days/1014100aqua', desc: '阿库娅 — 美好世界 (32动画)' },
  { name: 'konosuba-002',  source: '为美好的世界献上祝福！Fantastic Days/1034100',   desc: '美好世界角色2 (26动画)' },

  // ═══ 碧蓝航线 — 舰娘 ═══
  { name: 'azur-01', source: '碧蓝航线 Azue Lane/Azue Lane(JP)/aersasi_2',    desc: '碧蓝航线舰娘1 (28动画)' },
  { name: 'azur-02', source: '碧蓝航线 Azue Lane/Azue Lane(JP)/aierdeliqi_4', desc: '碧蓝航线舰娘2 (15动画)' },
  { name: 'azur-03', source: '碧蓝航线 Azue Lane/Azue Lane(JP)/aidang_2',     desc: '碧蓝航线舰娘3 (14动画)' },

  // ═══ 少女次元 ═══
  { name: 'shoujo-01', source: '少女次元/001', desc: '少女次元角色 (15动画)' },

  // ═══ Live2D 官方示例 ═══
  { name: 'senko', source: 'Live2D/Senko_Normals', desc: 'Senko — Live2D官方示例 (4动画,有hit区)' },
]

// ── 工具函数 ──────────────────────────────────────
function git(args, options) {
  return execSync(`git ${args}`, { cwd: REPO, encoding: 'utf-8', ...options })
}

function log(msg) { console.log(`  ${msg}`) }

// ── 主流程 ────────────────────────────────────────
async function main() {
  if (!fs.existsSync(DEST)) fs.mkdirSync(DEST, { recursive: true })

  console.log(`准备下载 ${SELECTED_MODELS.length} 个模型到 ${DEST}\n`)

  let success = 0
  let failed = 0

  for (const model of SELECTED_MODELS) {
    const destDir = path.join(DEST, model.name)
    console.log(`[${model.name}] ${model.desc}`)

    try {
      // 如果目标已存在，跳过
      if (fs.existsSync(destDir)) {
        const existing = fs.readdirSync(destDir)
        const hasModel3 = existing.some(f => f.endsWith('.model3.json'))
        const hasMoc3 = existing.some(f => f.endsWith('.moc3'))
        if (hasModel3 && hasMoc3) {
          console.log(`  → 已存在，跳过`)
          success++
          continue
        }
      }

      // 1. 列出模型的所有文件
      let fileList
      try {
        fileList = git(`ls-tree -r --name-only "origin/master:${model.source}"`, { stdio: ['pipe', 'pipe', 'ignore'] })
          .trim().split('\n').filter(Boolean)
      } catch (e) {
        console.log(`  ✗ 无法列出文件: ${e.message.slice(0, 80)}`)
        failed++
        continue
      }

      // 2. 创建目标目录
      fs.mkdirSync(destDir, { recursive: true })

      // 3. 逐个下载文件
      let downloaded = 0
      for (const file of fileList) {
        const destPath = path.join(destDir, file)
        const destParent = path.dirname(destPath)

        // 确保子目录存在
        if (!fs.existsSync(destParent)) {
          fs.mkdirSync(destParent, { recursive: true })
        }

        try {
          // 对 blob 用 cat-file -p 获取内容；对 tree 跳过
          const objType = git(`cat-file -t "origin/master:${model.source}/${file}"`, { stdio: ['pipe', 'pipe', 'ignore'] }).trim()

          if (objType === 'blob') {
            const content = execSync(
              `git cat-file -p "origin/master:${model.source}/${file}"`,
              { cwd: REPO, encoding: 'buffer', maxBuffer: 50 * 1024 * 1024, stdio: ['pipe', 'pipe', 'ignore'] }
            )
            fs.writeFileSync(destPath, content)
            downloaded++
          } else {
            // tree — 已经作为目录创建了
          }
        } catch (e) {
          // 某些条目可能无法直接访问
          log(`警告: 无法提取 ${file}: ${e.message.slice(0, 40)}`)
        }
      }

      // 4. 验证
      const resultFiles = fs.readdirSync(destDir, { recursive: true })
      const hasModel3 = resultFiles.some(f => f.endsWith('.model3.json'))
      const hasMoc3 = resultFiles.some(f => f.endsWith('.moc3'))
      const motionCount = resultFiles.filter(f => f.endsWith('.motion3.json')).length
      const textureCount = resultFiles.filter(f => f.match(/\.(png|jpg)$/i)).length

      if (hasModel3 && hasMoc3) {
        console.log(`  ✓ 成功 (${downloaded} 文件, ${motionCount} 动画, ${textureCount} 纹理)`)
        success++
      } else {
        console.log(`  ⚠ 部分完成 (model3=${hasModel3}, moc3=${hasMoc3}, ${downloaded} 文件)`)
        success++
      }

    } catch (e) {
      console.log(`  ✗ 失败: ${e.message.slice(0, 100)}`)
      failed++
    }
  }

  console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━`)
  console.log(`完成: ${success} 成功, ${failed} 失败`)
  console.log(`模型目录: ${DEST}`)

  // 列出所有可用模型
  const dirs = fs.readdirSync(DEST, { withFileTypes: true })
    .filter(d => d.isDirectory() && d.name !== '_repo')
    .map(d => d.name)
  console.log(`可用模型 (${dirs.length}): ${dirs.join(', ')}`)
}

main().catch(e => {
  console.error('错误:', e.message)
  process.exit(1)
})
