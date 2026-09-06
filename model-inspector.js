const fs = require('fs')
const path = require('path')

const END_OF_CENTRAL_DIRECTORY = 0x06054b50
const CENTRAL_DIRECTORY_ENTRY = 0x02014b50
const MAX_ZIP_COMMENT_SIZE = 0xffff

function readExactly(fd, buffer, position) {
  let offset = 0
  while (offset < buffer.length) {
    const bytesRead = fs.readSync(fd, buffer, offset, buffer.length - offset, position + offset)
    if (!bytesRead) throw new Error('ZIP 文件内容不完整')
    offset += bytesRead
  }
}

// 模型扫描只需要 ZIP 中的文件名。直接读取中央目录可以保持同步扫描，
// 同时避免为检查格式而解压几 MB 的纹理和 moc 文件。
function readZipEntryNames(archivePath) {
  const fd = fs.openSync(archivePath, 'r')
  try {
    const size = fs.fstatSync(fd).size
    if (size < 22) throw new Error('ZIP 文件过小')

    const tailSize = Math.min(size, 22 + MAX_ZIP_COMMENT_SIZE)
    const tail = Buffer.allocUnsafe(tailSize)
    readExactly(fd, tail, size - tailSize)

    let endOffset = -1
    for (let offset = tail.length - 22; offset >= 0; offset--) {
      if (
        tail.readUInt32LE(offset) === END_OF_CENTRAL_DIRECTORY &&
        offset + 22 + tail.readUInt16LE(offset + 20) === tail.length
      ) {
        endOffset = offset
        break
      }
    }
    if (endOffset < 0) throw new Error('找不到 ZIP 中央目录')

    const entryCount = tail.readUInt16LE(endOffset + 10)
    const directorySize = tail.readUInt32LE(endOffset + 12)
    const directoryOffset = tail.readUInt32LE(endOffset + 16)
    if (entryCount === 0xffff || directorySize === 0xffffffff || directoryOffset === 0xffffffff) {
      throw new Error('暂不支持 ZIP64 模型包')
    }
    if (directoryOffset + directorySize > size) throw new Error('ZIP 中央目录位置无效')

    const directory = Buffer.allocUnsafe(directorySize)
    readExactly(fd, directory, directoryOffset)
    const names = []
    let offset = 0
    for (let index = 0; index < entryCount; index++) {
      if (offset + 46 > directory.length || directory.readUInt32LE(offset) !== CENTRAL_DIRECTORY_ENTRY) {
        throw new Error('ZIP 中央目录条目无效')
      }
      const nameLength = directory.readUInt16LE(offset + 28)
      const extraLength = directory.readUInt16LE(offset + 30)
      const commentLength = directory.readUInt16LE(offset + 32)
      const nameStart = offset + 46
      const nextOffset = nameStart + nameLength + extraLength + commentLength
      if (nextOffset > directory.length) throw new Error('ZIP 中央目录条目不完整')
      names.push(directory.toString('utf8', nameStart, nameStart + nameLength).replace(/\\/g, '/'))
      offset = nextOffset
    }
    return names
  } finally {
    fs.closeSync(fd)
  }
}

function unsupportedCubism2(source, format) {
  return {
    source,
    format,
    cubismVersion: 2,
    status: 'unsupported',
    statusMessage: 'Cubism 2 暂不支持（需要 .model3.json / .moc3）',
  }
}

function invalidModel(source, format, message) {
  return {
    source,
    format,
    cubismVersion: null,
    status: 'invalid',
    statusMessage: message,
  }
}

function inspectFolderModel(directory, descriptor) {
  try {
    const settings = JSON.parse(fs.readFileSync(path.join(directory, descriptor), 'utf8'))
    const moc = settings && settings.FileReferences && settings.FileReferences.Moc
    if (!moc || !fs.existsSync(path.resolve(directory, moc))) {
      return invalidModel(descriptor, 'folder', '模型缺少 .moc3 文件')
    }
    return {
      source: descriptor,
      format: 'folder',
      cubismVersion: 3,
      status: 'ready',
      statusMessage: '',
    }
  } catch (error) {
    return invalidModel(descriptor, 'folder', `无法读取 model3.json：${error.message}`)
  }
}

function inspectArchive(directory, archive) {
  try {
    const entryNames = readZipEntryNames(path.join(directory, archive))
    const files = entryNames
      .filter(name => name && !name.endsWith('/'))
      .map(name => ({ original: name, lower: name.toLowerCase() }))
    const model3 = files.find(file => file.lower.endsWith('.model3.json'))
    const moc3 = files.find(file => file.lower.endsWith('.moc3'))
    if (model3) {
      if (!moc3) return invalidModel(archive, 'zip', 'Cubism 3 模型包缺少 .moc3 文件')
      // live2d-renderer 0.6.6 会剥掉 ZIP 的第一层路径，根目录模型无法被它读取。
      if (!model3.original.includes('/')) {
        return invalidModel(archive, 'zip', 'ZIP 内模型文件需要放在一级子目录中')
      }
      return {
        source: archive,
        format: 'zip',
        cubismVersion: 3,
        status: 'ready',
        statusMessage: '',
      }
    }

    const legacyDescriptor = files.find(file =>
      file.lower === 'model.json' || file.lower.endsWith('/model.json') || file.lower.endsWith('.model.json')
    )
    const legacyMoc = files.find(file => file.lower.endsWith('.moc'))
    if (legacyDescriptor || legacyMoc) return unsupportedCubism2(archive, 'zip')
    return invalidModel(archive, 'zip', 'ZIP 内没有找到 Cubism 模型描述文件')
  } catch (error) {
    return invalidModel(archive, 'zip', `无法读取 ZIP：${error.message}`)
  }
}

function inspectModelArchive(archivePath) {
  if (typeof archivePath !== 'string' || path.extname(archivePath).toLowerCase() !== '.zip') {
    return invalidModel(path.basename(String(archivePath || '')), 'zip', '请选择 .zip 模型包')
  }
  return inspectArchive(path.dirname(archivePath), path.basename(archivePath))
}

function inspectModelDirectory(directory) {
  const files = fs.readdirSync(directory)
  const descriptor = files.find(file => file.toLowerCase().endsWith('.model3.json'))
  if (descriptor) return inspectFolderModel(directory, descriptor)

  const legacyDescriptor = files.find(file => {
    const lower = file.toLowerCase()
    return lower === 'model.json' || lower.endsWith('.model.json')
  })
  if (legacyDescriptor) return unsupportedCubism2(legacyDescriptor, 'folder')

  const archive = files.find(file => file.toLowerCase().endsWith('.zip'))
  return archive ? inspectArchive(directory, archive) : null
}

module.exports = { inspectModelArchive, inspectModelDirectory, readZipEntryNames }
