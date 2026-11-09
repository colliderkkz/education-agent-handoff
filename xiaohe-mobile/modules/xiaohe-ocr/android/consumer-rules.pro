# These exact registrars are listed in ML Kit's merged AndroidManifest metadata.
# Firebase ComponentDiscovery loads each name and calls
# Class.forName(name).getDeclaredConstructor().newInstance().
# The dependency's class-only keep rule does not retain the constructor under
# R8 full mode. Keep only these three reflected types and their public no-arg
# constructors; unrelated ML Kit / Google Play classes remain optimizable.
# Source: https://github.com/firebase/firebase-android-sdk/blob/main/firebase-components/src/main/java/com/google/firebase/components/ComponentDiscovery.java
-keep class com.google.mlkit.common.internal.CommonComponentRegistrar {
  public <init>();
}
-keep class com.google.mlkit.vision.common.internal.VisionCommonRegistrar {
  public <init>();
}
-keep class com.google.mlkit.vision.text.internal.TextRegistrar {
  public <init>();
}
