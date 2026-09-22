// SPDX-License-Identifier: MIT
//
// Every place a typed `.` has to become `->`, and every place it must not, on
// one screen. Each position is marked with a `// [n]` comment on the line
// above; README.md says what to expect at each.
//
// Nothing here is included from the standard library. This folder ships no
// compiler flags, and a `<memory>` that does not resolve would turn a wrong
// answer into an unanswered question. The two types that must be left alone -
// a smart pointer and an iterator - are written out instead, because what
// decides their case is that they are classes with `operator->`, which is
// exactly what unique_ptr, shared_ptr and vector::iterator are.

struct AddrInfo {
  int id;
  bool valid;
};

struct AddressMgr {
  void UpdateAddress(const AddrInfo& info, bool force);
  int Count() const;
  AddrInfo* First();
};

// Owns a pointer and hands it out with `->`, the way unique_ptr does. A dot on
// one of these is correct - `.reset()`, `.get()` - and must survive.
template <typename T>
struct Owned {
  T* get();
  void reset();
  T* operator->();
  T& operator*();
};

// An iterator: both `.` and `->` mean something, and only the writer knows which.
template <typename T>
struct Cursor {
  T* operator->();
  T& operator*();
  Cursor& operator++();
};

struct Node {
  Node* next;
  AddressMgr mgr;
};

void cases(AddressMgr* pMgr, AddressMgr& rMgr, AddressMgr vMgr, Node* pNode) {
  Owned<AddressMgr> owned;
  Cursor<AddrInfo> it;
  AddressMgr** ppMgr = &pMgr;

  // [1] a raw pointer - the one case this feature exists for
  pMgr;

  // [2] a reference
  rMgr;

  // [3] a value
  vMgr;

  // [4] a smart pointer
  owned;

  // [5] an iterator
  it;

  // [6] a pointer reached through another pointer
  pNode->next;

  // [7] a value reached through a pointer
  pNode->mgr;

  // [8] a pointer to a pointer
  ppMgr;

  // [9] a decimal point
  float f = 3;

  // [10] inside a comment: pMgr
  f = f;

  // [11] inside a string literal
  const char* s = "pMgr";

  // [12] after a call, where the left side is an expression rather than a name
  pMgr->First();

  (void)s;
  (void)f;
}
