#pragma once

// Round trip fixture. Cursor positions are marked [1]..[8]. See README.md.

class Shape {
public:
  virtual ~Shape() = default;

  // [5] base virtual - two overrides, so a menu of both, each marked Override
  virtual double area() const = 0;
};

class Circle : public Shape {
public:
  explicit Circle(double r);

  // [6] override - the definition in shape.cpp, and the base virtual above
  double area() const override;

private:
  double radius_;
};

class Square : public Shape {
public:
  explicit Square(double side);

  double area() const override;

private:
  double side_;
};

// [2] declaration - lands on the definition in shape.cpp
double totalArea(const Shape** shapes, int count);

// One name in two namespaces. [8] in main.cpp asks for geo's, and ui's must not
// show up.
namespace geo {
double scale(double value, double factor);
}

namespace ui {
double scale(double value, double factor);
}
