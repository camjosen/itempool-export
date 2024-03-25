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
