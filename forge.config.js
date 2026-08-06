module.exports = {
  packagerConfig: {
    name: 'Vashisht Devasani',
    executableName: 'Vashisht Devasani',
    appBundleId: 'com.vashisht.devasani',
    appCategoryType: 'public.app-category.productivity',
    extendInfo: {
      NSMicrophoneUsageDescription: 'Vashisht Devasani uses the microphone to transcribe your spoken questions locally on this Mac.'
    },
    icon: '/Users/vashishtdevasani/PersonalAIData/Apps/Vasisht2ndBrain/assets/icon',
    asar: true,
    extraResource: [
      '/Users/vashishtdevasani/PersonalAIData/Apps/Vasisht2ndBrain/backend',
      '/Users/vashishtdevasani/PersonalAIData/Apps/Vasisht2ndBrain/native',
      '/Users/vashishtdevasani/PersonalAIData/95_tools/second_brain/transcribe_voice_command.py',
      '/Users/vashishtdevasani/PersonalAIData/05_private_pii/tools/ocr_document.swift'
    ]
  },
  makers: [
    { name: '@electron-forge/maker-zip', platforms: ['darwin'] }
  ]
};
