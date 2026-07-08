# Decoy: everything here renders fine

Intro links: [inline](./decoy-thai.md), [full ref][ok-def], [collapsed][], [shortcut].

- [x] task list checkbox is not a reference
- [ ] neither is this one
- plain [bracketed text] with no definition is prose
- wiki-style [[double brackets]] too

URLs that are fine: <https://example.com/autolink> and `https://in-code.example.com` and `www.in-code.example.com` stay unflagged.

    https://in-indented-code.example.com/also-fine

```text
https://in-fenced-code.example.com/fine-too
[not-a-ref][nope] inside a fence
| bad | table | inside | fence | with | extras |
```

## Repeated heading

## Repeated heading

Anchors: [first](#repeated-heading) and [second](#repeated-heading-1) both resolve.

Anchor via HTML: <a id="custom-anchor"></a> then [jump](#custom-anchor).

## Heading with `code` and *emphasis*

Link to it: [fancy](#heading-with-code-and-emphasis).

Setext heading
--------------

Link: [setext](#setext-heading).

| Column A | Column B |
| :--- | ---: |
| escaped \| pipe | ok |
| padded row |

> Blockquote with a [good ref][ok-def] inside.
> Lazy continuation line stays in the quote.

1. ordered list
   1. nested ordered
2. second item

   loose paragraph inside item

External targets are skipped: [https scheme](https://example.com/x), [protocol-relative](//cdn.example.com/x), [mailto](mailto:someone@example.com), [site-root](/absolute/is/skipped).

[ok-def]: ./decoy-thai.md "A live target"
[collapsed]: #repeated-heading
[shortcut]: https://example.com/defined
