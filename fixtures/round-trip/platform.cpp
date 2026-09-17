#include "platform.h"

// Three versions, one active. Nothing defines TARGET_ANDROID or TARGET_IOS, so
// the #else one is what the language server compiles.
#ifdef TARGET_ANDROID
double pixelDensity() {
  return 2.0;
}
#elif defined(TARGET_IOS)
double pixelDensity() {
  return 3.0;
}
#else
// [10] the active definition
double pixelDensity() {
  return 1.0;
}
#endif

double toPixels(double points) {
  // [9] call site - which of the three versions, and the stub, come back
  return points * pixelDensity();
}
