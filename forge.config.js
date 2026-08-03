module.exports = {
  packagerConfig: {
    name: 'Vashisht Devasani',
    executableName: 'Vashisht Devasani',
    appBundleId: 'com.vashisht.devasani',
    appCategoryType: 'public.app-category.productivity',
    extendInfo: {
      NSMicrophoneUsageDescription: 'Vashisht Devasani uses the microphone to transcribe your spoken questions locally on this Mac.'
    },
    icon: './assets/icon',
    asar: true,
    extraResource: [
      './backend',
      './native',
      './tools'
    ]
  },
  makers: [
    { name: '@electron-forge/maker-zip', platforms: ['darwin'] }
  ]
};
