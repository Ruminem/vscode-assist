#include "shape.h"

Circle::Circle(double r) : radius_(r) {}

// [4] override body - the declaration in shape.h, and the base virtual it
// overrides
double Circle::area() const {
  return 3.14159265358979 * radius_ * radius_;
}

Square::Square(double side) : side_(side) {}

double Square::area() const {
  return side_ * side_;
}

// [3] definition - goes back to the declaration in shape.h
double totalArea(const Shape** shapes, int count) {
  double sum = 0.0;
  for (int i = 0; i < count; ++i) {
    // [7] a call through the base - the base virtual, and both overrides. Also
    // the reason isHere prefers targetSelectionRange: the call is inside a body
    sum += shapes[i]->area();
  }
  return sum;
}

namespace geo {
double scale(double value, double factor) {
  return value * factor;
}
}  // namespace geo

namespace ui {
double scale(double value, double factor) {
  return value * factor * 0.5;
}
}  // namespace ui
