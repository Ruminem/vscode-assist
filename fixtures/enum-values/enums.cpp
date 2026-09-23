// Every shape assist.enumValues.enabled has to get right. Open this folder in
// the Extension Development Host with clangd installed; no compile database is
// needed, clangd's fallback flags parse it. cpptools alone should give the same
// hints. The comment on each line is the hint that should appear at its end.
// Servers show these comments in the hover as the enumerator's documentation,
// which is why each starts with "expect" - it is not the server talking.

enum Plain {
  A,        // expect = 0 (0x0)
  B,        // expect = 1 (0x1)
  C = 10,   // expect none - the initializer already says 10
  D,        // expect = 11 (0xB)
};

enum class Flags : unsigned char {
  None = 0,             // expect none
  Read = 1 << 0,        // expect = 1 (0x1)
  Write = 1 << 1,       // expect = 2 (0x2)
  All = Read | Write,   // expect = 3 (0x3)
};

enum Signed {
  Minus = -1,   // expect none
  Zero,         // expect = 0 (0x0)
};

enum Big : unsigned long long {
  Huge = 0xFFFFFFFFFFFFFFFFull,   // expect = 18446744073709551615
  Half = Huge >> 1,               // expect = 9223372036854775807 (0x7FFFFFFFFFFFFFFF)
};

enum Chars : char {
  Ex = 'x',   // expect = 120 (0x78)
};

constexpr int k = 7;
enum FromConst {
  Q = k + 1,   // expect = 8 (0x8)
};

struct Outer {
  enum Inner {
    X = 3,   // expect none
    Y,       // expect = 4 (0x4)
  };
};

template <int K> struct Scaled {
  enum { V = K * 2 };   // expect none - the value depends on K
};

int main() { return A + Outer::X; }
