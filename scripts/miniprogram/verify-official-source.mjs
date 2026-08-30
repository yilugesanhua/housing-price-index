import { verifyOfficialSource } from './official-source-verifier.mjs'

const argument = (name) => process.argv.find((value) => value.startsWith(`--${name}=`))?.slice(name.length + 3)
const sourceUrl = argument('url')
const expectedHash = argument('sha256')
console.log(JSON.stringify(await verifyOfficialSource({ sourceUrl, expectedHash })))
