// CSS Modules type declarations for side-effect imports
declare module '*.css' {
  const content: undefined
  export default content
}

declare module '*.module.css' {
  const classes: Record<string, string>
  export default classes
}

declare module '*.module.scss' {
  const classes: Record<string, string>
  export default classes
}
