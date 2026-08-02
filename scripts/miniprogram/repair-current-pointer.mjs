const argument = (name) => process.argv.find((value) => value.startsWith(`--${name}=`))?.slice(name.length + 3)

const datasetVersion = argument('dataset')
if (!/^20\d{2}-(0[1-9]|1[0-2])-[a-f0-9]{12}$/.test(datasetVersion || '')) {
  throw new Error('Use --dataset=<active-version>')
}

throw new Error(
  'Direct current.json repair is disabled under control schema v1. '
  + 'The single approved production legacy pointer must use miniprogram:data:migrate-legacy-control; all other changes must use the audited publish or rollback command. '
  + 'Any future repair workflow must preserve the immutable revocation registry, '
  + 'increase control_generation, recheck the exact remote baseline before writing, and verify the cloud function response.',
)
