#!/usr/bin/env python3

import sys
import os
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import scanpy as sc
import h5py
from cellxgene_schema.utils import read_h5ad

from backend.layers.processing.h5ad_data_file import H5ADDataFile

# Set input information
input_file="my_data/test2.h5ad"
tmp_file="my_data/tmp.h5ad"
output_folder="my_data/test2.cxg"
sparse_threshold=25.0 # for 25%, percentage of non-zero values in the matrix above which the matrix will be considered dense and below which it will be considered sparse
dataset_version_id="dataset_version_id"
schema_version = "7.0.0"
dataset_title = "dataset_title"
need_format_correction = False

def correct_h5ad_format(input_file=input_file, converted_file=tmp_file, schema_version=schema_version, dataset_title=dataset_title):

    # Fix the issue of wrong format of obs
    adata = sc.read_h5ad(input_file)
    adata.write_h5ad(converted_file)
    
    # Fix the issue of missing required metadata fields in uns
    # https://github.com/chanzuckerberg/single-cell-curation/blob/main/schema/7.0.0/schema.md
    adata = sc.read_h5ad(converted_file)
    adata.uns['schema_version'] = schema_version
    adata.uns['title'] = dataset_title
    adata.write_h5ad(converted_file)

    return converted_file

if need_format_correction:
    input_file = correct_h5ad_format(input_file=input_file, converted_file=tmp_file, schema_version=schema_version, dataset_title=dataset_title)

# Initialize with H5AD file
h5ad_file = H5ADDataFile(
    input_filename=input_file
)

# Convert to CXG format
h5ad_file.to_cxg(
    output_cxg_directory=output_folder,
    sparse_threshold=sparse_threshold,
    dataset_version_id=dataset_version_id
)