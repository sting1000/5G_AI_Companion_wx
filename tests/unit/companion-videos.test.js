describe('companion-videos 预下载顺序', () => {
  function loadUtil() {
    jest.resetModules()
    return require('../../miniprogram/utils/companion-videos')
  }

  test('prefetch 先下完 speaking 再下 idle', () => {
    const pending = []
    wx.downloadFile.mockImplementation(({ url, filePath, success }) => {
      pending.push({
        url,
        done: () => success({
          tempFilePath: filePath || '/tmp/video.mp4',
          statusCode: 200,
        }),
      })
    })
    const { prefetchCompanionVideos } = loadUtil()
    prefetchCompanionVideos()
    expect(pending).toHaveLength(1)
    expect(String(pending[0].url)).toContain('speaking')
    pending[0].done()
    expect(pending).toHaveLength(2)
    expect(String(pending[1].url)).toContain('idle')
  })

  test('本地已有 speaking 时 prefetch 会立刻开始下 idle', () => {
    wx.__fs.__savedFiles.add('/tmp/companion-xiaolin-speaking.mp4')
    const urls = []
    wx.downloadFile.mockImplementation(({ url, filePath, success }) => {
      urls.push(url)
      success({
        tempFilePath: filePath || '/tmp/video.mp4',
        statusCode: 200,
      })
    })
    const { prefetchCompanionVideos } = loadUtil()
    prefetchCompanionVideos()
    expect(urls).toHaveLength(1)
    expect(String(urls[0])).toContain('idle')
  })
})
