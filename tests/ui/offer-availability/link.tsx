// Keep isolated component links in the fixture; no Next server is involved.
import React from "react";
export default function Link({
  href,
  children,
  ...props
}: React.PropsWithChildren<{ href: string }>) {
  return (
    <a href={href} {...props}>
      {children}
    </a>
  );
}
