#include "shape.h"

int main() {
  Circle a(1.0);
  Square b(2.0);
  const Shape* shapes[] = {&a, &b};

  // [1] call site - offers the definition and the declaration
  auto sum = totalArea(shapes, 2);

  // [8] namespaced call site - geo's definition and declaration, nothing of ui's
  auto big = geo::scale(sum, 2.0);

  return big > sum ? 0 : 1;
}
