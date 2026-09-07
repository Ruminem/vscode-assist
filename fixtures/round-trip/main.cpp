#include "shape.h"

#include <cstdio>

int main() {
  Circle a(1.0);
  Circle b(2.0);
  const Shape* shapes[] = {&a, &b};

  // [1] call site - offers the definition and the declaration
  double sum = totalArea(shapes, 2);

  std::printf("%f\n", sum);
  return 0;
}
