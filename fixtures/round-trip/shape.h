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

// Not a round trip position. Here so assist.enumValues.enabled can be seen in
// the same window: each enumerator should end with its value, except where the
// initializer already says it. Kept below everything so the lines above, which
// README.md points at, do not move. fixtures/enum-values/ has every shape.
enum class Corner { TopLeft, TopRight, BottomRight = 4, BottomLeft };

enum Layer : unsigned {
  Fill = 1u << 0,
  Stroke = 1u << 1,
  Shadow = 1u << 4,
  Everything = Fill | Stroke | Shadow,
  test = 0x9,
  test2 = 0x99,
  test3 = 0x999,
  test4 = 0x9999
};

struct Palette {
  enum Tone : char { Light = 'l', Dark = 'd', Unset = -1 };
};
