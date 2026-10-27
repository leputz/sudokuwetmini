// app.ts
App<IAppOption>({
  globalData: {},
  onLaunch() {
    // Demonstrate local storage capabilities
    const logs = wx.getStorageSync('logs') || []
    logs.unshift(Date.now())
    wx.setStorageSync('logs', logs)

    // Log in
    wx.login({
      success: res => {
        console.log(res.code)
        // Send res.code to the backend to obtain openId, sessionKey, and unionId
      },
    })
  },
})