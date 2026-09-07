#include "shape.h"

Circle::Circle(double r) : radius_(r) {}

// [4] member body - every provider answers with this same line, so subtracting
// "where the cursor already is" leaves nothing and only the name search has
// anywhere to send you
double Circle::area() const {
  return 3.14159265358979 * radius_ * radius_;
}

// [3] definition - goes back to the declaration in shape.h
double totalArea(const Shape** shapes, int count) {
  double sum = 0.0;
  for (int i = 0; i < count; ++i) {
    // a call inside the body: the reason isHere prefers targetSelectionRange
    sum += shapes[i]->area();
  }
  return sum;
}
