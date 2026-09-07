#pragma once

// Round trip fixture. Five cursor positions, marked [1]..[5]. See README.md.

class Shape {
public:
  virtual ~Shape() = default;

  // [5] base virtual - lands on the override in shape.cpp
  virtual double area() const = 0;
};

class Circle : public Shape {
public:
  explicit Circle(double r);

  double area() const override;

private:
  double radius_;
};

// [2] declaration - lands on the definition in shape.cpp
double totalArea(const Shape** shapes, int count);
