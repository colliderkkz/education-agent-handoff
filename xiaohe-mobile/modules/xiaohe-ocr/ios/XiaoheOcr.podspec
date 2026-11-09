Pod::Spec.new do |s|
  s.name           = 'XiaoheOcr'
  s.version        = '0.1.0'
  s.summary        = 'On-device Chinese text candidates for local photo review'
  s.description   = 'Vision OCR of app-owned still images, with bounded decoding and manual verification.'
  s.author         = 'Xiaohe'
  s.homepage       = 'https://docs.expo.dev/modules/'
  s.platforms      = {
    :ios => '16.4'
  }
  s.source         = { git: '' }
  s.static_framework = true
  s.swift_version = '5.9'
  s.frameworks = 'Vision', 'ImageIO', 'CryptoKit'

  s.dependency 'ExpoModulesCore'

  # Swift/Objective-C compatibility
  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
  }

  s.source_files = "**/*.{h,m,mm,swift,hpp,cpp}"
end
