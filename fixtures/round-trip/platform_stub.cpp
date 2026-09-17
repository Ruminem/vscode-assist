#include "platform.h"

// A fourth version in its own file, switched off as a whole - the shape of
// Nav_stub.cpp next to Nav.cpp.
#if defined(USE_PLATFORM_STUB)
double pixelDensity() {
  return 0.5;
}
#endif
