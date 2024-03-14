# R.I.P. Itempool (2020 - 2024)

Itempool was a question banking system with special support for math and
live lectures. It launched in 2020 to support Grant Sanderson's "Lockdown Math"
series. Thousands of teachers and hundreds of thousands of students used
Itempool for one purpose or another.

## How to generate zip files (requires AWS credentials)

First, download the content from S3. I considered not requiring this step,
since the script could read directly from S3, but that was slower for
development, and I didn't know how much all of that data transfer would cost.

```
aws s3 sync s3://itempool-db-exported/itempool-db-export database/paraquet
aws s3 sync s3://public.itempooluserdata.com images
```

Then, run a script.

```
ts-node createZipFiles.ts
```
